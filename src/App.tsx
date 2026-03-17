import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Input,
  Layout,
  List,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message
} from 'antd';
import {
  ApiOutlined,
  DeleteOutlined,
  FilterOutlined,
  InboxOutlined,
  ReloadOutlined,
  RobotOutlined,
  SettingOutlined,
  UserOutlined
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import _ from 'lodash';
import authorMapping from '../author_mapping.json';
import {
  BranchSummary,
  ProjectSummary,
  RunSummary,
  cancelRun,
  clearProjectCache,
  createBranch,
  createProject,
  deleteProject,
  getLatestBranchResult,
  getProjectCache,
  getProjectDetail,
  getRun,
  healthCheck,
  listBranchRuns,
  listProjects,
  triggerBranchUpdate
} from './utils/api';
import { AggregatedStats, DashboardStats, FileInfo, processCSVFiles } from './utils/dataProcessor';

const { Header, Content } = Layout;
const { Dragger } = Upload;
const { Title, Text } = Typography;

type MetricKey = 'added' | 'deleted' | 'net';
type DataSourceMode = 'service' | 'csv';

const metricLabels: Record<MetricKey, { label: string; color: string }> = {
  added: { label: '新增行数', color: '#52c41a' },
  deleted: { label: '删除行数', color: '#ff4d4f' },
  net: { label: '净增行数', color: '#1890ff' }
};

const runStatusColors: Record<string, string> = {
  queued: 'default',
  cloning: 'processing',
  fetching: 'processing',
  analyzing: 'processing',
  succeeded: 'success',
  failed: 'error',
  canceled: 'warning'
};

const activeRunStatuses = new Set(['queued', 'cloning', 'fetching', 'analyzing']);
const selectedProjectStorageKey = 'code_analyze_selected_project_id';
const selectedBranchStorageKey = 'code_analyze_selected_branch_id';

const isUndefinedValue = (value: unknown) => {
  const text = String(value ?? '').trim().toLowerCase();
  return !value || text === 'undefined' || text === 'null' || text === '未知' || text === '-' || text === '总计' || text === '';
};

const getInitialGroups = (stats: AggregatedStats | null, showUndefined: boolean) => {
  if (!stats) {
    return [];
  }
  return stats.allGroups.filter(group => (showUndefined ? true : !isUndefinedValue(group)));
};

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

const formatTime = (value?: string | null) => {
  if (!value) {
    return '暂无';
  }
  return new Date(value).toLocaleString();
};

const formatBytes = (value?: number) => {
  if (!value) {
    return '0 B';
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

const App: React.FC = () => {
  const initialProjectId = Number(localStorage.getItem(selectedProjectStorageKey) || '');
  const initialBranchId = Number(localStorage.getItem(selectedBranchStorageKey) || '');
  const pollingRunIdRef = useRef<number | null>(null);

  const [rawFiles, setRawFiles] = useState<FileInfo[]>([]);
  const [localStats, setLocalStats] = useState<DashboardStats | null>(null);
  const [remoteStats, setRemoteStats] = useState<DashboardStats | null>(null);
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>('service');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [metric, setMetric] = useState<MetricKey>('added');
  const [selectedAuthor, setSelectedAuthor] = useState<string | undefined>(undefined);
  const [showUndefined, setShowUndefined] = useState<boolean>(false);
  const [topN, setTopN] = useState<number>(10);
  const [monthlySelectedAuthors, setMonthlySelectedAuthors] = useState<string[]>([]);
  const [monthlySelectedMonths, setMonthlySelectedMonths] = useState<string[]>([]);

  const [serviceAvailable, setServiceAvailable] = useState<boolean | null>(null);
  const [serviceHint, setServiceHint] = useState<string>('正在检查后端服务...');
  const [serviceBusy, setServiceBusy] = useState<boolean>(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(Number.isFinite(initialProjectId) ? initialProjectId : undefined);
  const [selectedBranchId, setSelectedBranchId] = useState<number | undefined>(Number.isFinite(initialBranchId) ? initialBranchId : undefined);
  const [activeRun, setActiveRun] = useState<RunSummary | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{
    local_repo_path: string;
    exists: boolean;
    size_bytes: number;
    last_fetched_at?: string | null;
  } | null>(null);

  const [newProjectName, setNewProjectName] = useState<string>('');
  const [newGitUrl, setNewGitUrl] = useState<string>('');
  const [newDefaultBranch, setNewDefaultBranch] = useState<string>('main');
  const [newBranchName, setNewBranchName] = useState<string>('');

  // AI 相关状态
  const [aiApiKey, setAiApiKey] = useState<string>(localStorage.getItem('ai_api_key') || '');
  const [aiApiUrl, setAiApiUrl] = useState<string>(localStorage.getItem('ai_api_url') || 'https://api.deepseek.com/v1/chat/completions');
  const [aiModel, setAiApiModel] = useState<string>(localStorage.getItem('ai_model') || 'deepseek-chat');
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [aiAnalysisMode, setAiAnalysisMode] = useState<'overview' | 'project' | 'author'>('overview');
  const [aiTargetItems, setAiTargetItems] = useState<string[]>([]);
  const [aiCustomFocus, setAiCustomFocus] = useState<string>('');

  const baseStats = useMemo(
    () => (dataSourceMode === 'service' ? remoteStats : localStats),
    [dataSourceMode, localStats, remoteStats]
  );

  const selectedProject = useMemo(
    () => projects.find(project => project.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const selectedBranch = useMemo(
    () => branches.find(branch => branch.id === selectedBranchId),
    [branches, selectedBranchId]
  );

  const loadLatestResult = async (projectId: number, branchId: number, notify = true) => {
    try {
      const result = await getLatestBranchResult(projectId, branchId);
      setRemoteStats(result);
      setDataSourceMode('service');
      if (notify) {
        message.success('已加载最新分析结果');
      }
    } catch (error) {
      setRemoteStats(null);
      if (notify) {
        message.warning(error instanceof Error ? error.message : '该分支暂无分析结果');
      }
    }
  };

  const recoverActiveRun = async (projectId: number, branchId: number) => {
    const runs = await listBranchRuns(projectId, branchId);
    const active = runs.find(run => activeRunStatuses.has(run.status));
    if (!active) {
      setActiveRun(null);
      return false;
    }

    setActiveRun(active);
    if (pollingRunIdRef.current !== active.id) {
      void pollRunUntilFinished(projectId, branchId, active.id, true);
    }
    return true;
  };

  const loadProjectContext = async (
    projectId: number,
    preferredBranchId?: number,
    autoLoadLatestResult = true
  ) => {
    const [detail, cache] = await Promise.all([
      getProjectDetail(projectId),
      getProjectCache(projectId)
    ]);

    setBranches(detail.branches);
    setCacheInfo(cache);

    if (detail.branches.length === 0) {
      setSelectedBranchId(undefined);
      setRemoteStats(null);
      setActiveRun(null);
      return;
    }

    const branchId =
      preferredBranchId && detail.branches.some(branch => branch.id === preferredBranchId)
        ? preferredBranchId
        : selectedBranchId && detail.branches.some(branch => branch.id === selectedBranchId)
          ? selectedBranchId
          : detail.branches.find(branch => branch.is_default)?.id || detail.branches[0].id;

    setSelectedBranchId(branchId);
    const hasActiveRun = await recoverActiveRun(projectId, branchId);
    if (autoLoadLatestResult && !hasActiveRun) {
      await loadLatestResult(projectId, branchId, false);
    }
  };

  const refreshProjects = async (preferredProjectId?: number, preferredBranchId?: number) => {
    const items = await listProjects();
    setProjects(items);

    if (items.length === 0) {
      setSelectedProjectId(undefined);
      setSelectedBranchId(undefined);
      setBranches([]);
      setCacheInfo(null);
      if (dataSourceMode === 'service') {
        setRemoteStats(null);
      }
      return;
    }

    const nextProjectId =
      preferredProjectId && items.some(project => project.id === preferredProjectId)
        ? preferredProjectId
        : selectedProjectId && items.some(project => project.id === selectedProjectId)
          ? selectedProjectId
          : items[0].id;

    setSelectedProjectId(nextProjectId);
    await loadProjectContext(nextProjectId, preferredBranchId);
  };

  const bootstrapService = async () => {
    try {
      await healthCheck();
      setServiceAvailable(true);
      setServiceHint('后端服务在线，可以直接通过 Git 地址创建项目并触发分析。');
      await refreshProjects();
    } catch (error) {
      setServiceAvailable(false);
      setServiceHint(error instanceof Error ? error.message : '后端服务暂不可用');
      setDataSourceMode('csv');
    }
  };

  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem(selectedProjectStorageKey, String(selectedProjectId));
    } else {
      localStorage.removeItem(selectedProjectStorageKey);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedBranchId) {
      localStorage.setItem(selectedBranchStorageKey, String(selectedBranchId));
    } else {
      localStorage.removeItem(selectedBranchStorageKey);
    }
  }, [selectedBranchId]);

  useEffect(() => {
    const loadLocalData = () => {
      const defaultModules = import.meta.glob('../data/**/*.csv', { query: '?raw', import: 'default', eager: true });
      const initialFiles: FileInfo[] = [];

      for (const [path, content] of Object.entries(defaultModules)) {
        const pathParts = path.split('/');
        const groupName = pathParts.length >= 4 ? pathParts[pathParts.indexOf('data') + 1] : '默认工程';

        initialFiles.push({
          name: path.replace('../data/', ''),
          path,
          content: content as string,
          groupName
        });
      }

      if (initialFiles.length > 0) {
        setRawFiles(initialFiles);
      }
    };

    loadLocalData();
    bootstrapService().catch(() => {
      setServiceAvailable(false);
      setServiceHint('后端服务检查失败');
      setDataSourceMode('csv');
    });
  }, []);

  useEffect(() => {
    if (rawFiles.length > 0) {
      processCSVFiles(rawFiles, authorMapping).then(result => {
        setLocalStats(result);
      });
      return;
    }
    setLocalStats(null);
  }, [rawFiles]);

  useEffect(() => {
    setSelectedGroups(getInitialGroups(baseStats, showUndefined));
  }, [baseStats, showUndefined]);

  const filteredStats = useMemo(() => {
    if (!baseStats || selectedGroups.length === 0) {
      return null;
    }

    const filteredFullData = baseStats.fullData.filter(record => {
      if (!selectedGroups.includes(record.group)) {
        return false;
      }
      if (!showUndefined) {
        if (
          isUndefinedValue(record.author) ||
          isUndefinedValue(record.project) ||
          isUndefinedValue(record.group) ||
          isUndefinedValue(record.month)
        ) {
          return false;
        }
      }
      return true;
    });

    const activeMonths = _.uniq(filteredFullData.map(record => String(record.month))).sort();
    const activeGroups = _.uniq(filteredFullData.map(record => record.group));

    const monthlyTrends = activeMonths.map(month => {
      const records = filteredFullData.filter(record => String(record.month) === month);
      return {
        month,
        added: _.sumBy(records, 'added'),
        deleted: _.sumBy(records, 'deleted'),
        net: _.sumBy(records, 'net'),
        commits: _.sumBy(records, 'commits')
      };
    });

    const groupMonthlyTrends: Record<string, any[]> = {};
    activeGroups.forEach(group => {
      groupMonthlyTrends[group] = activeMonths.map(month => {
        const records = filteredFullData.filter(record => record.group === group && String(record.month) === month);
        return {
          month,
          added: _.sumBy(records, 'added'),
          deleted: _.sumBy(records, 'deleted'),
          net: _.sumBy(records, 'net'),
          commits: _.sumBy(records, 'commits')
        };
      });
    });

    return {
      ...baseStats,
      totalAdded: _.sumBy(filteredFullData, 'added'),
      totalDeleted: _.sumBy(filteredFullData, 'deleted'),
      totalNet: _.sumBy(filteredFullData, 'net'),
      totalCommits: _.sumBy(filteredFullData, 'commits'),
      authorCount: _.uniqBy(filteredFullData, 'author').length,
      monthlyTrends,
      groupMonthlyTrends,
      activeGroups,
      allMonths: activeMonths,
      fullData: filteredFullData,
      groupStats: baseStats.groupStats.filter(group => activeGroups.includes(group.group)),
      projectStats: baseStats.projectStats.filter(project => activeGroups.includes(project.group)),
      authorProjectStats: baseStats.authorProjectStats.filter(item => activeGroups.includes(item.group))
    };
  }, [baseStats, selectedGroups, showUndefined]);

  const authorRanking = useMemo(() => {
    if (!filteredStats) {
      return [];
    }
    const grouped = _.groupBy(filteredStats.fullData, 'author');
    return Object.entries(grouped)
      .map(([author, records]) => ({
        author,
        added: _.sumBy(records, 'added'),
        deleted: _.sumBy(records, 'deleted'),
        net: _.sumBy(records, 'net'),
        commits: _.sumBy(records, 'commits')
      }))
      .sort((a, b) => b[metric] - a[metric]);
  }, [filteredStats, metric]);

  const authorRankingChartOption = useMemo(() => {
    if (authorRanking.length === 0) {
      return {};
    }
    const topData = [...authorRanking].slice(0, topN).reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '3%', containLabel: true },
      xAxis: { type: 'value', name: metricLabels[metric].label },
      yAxis: { type: 'category', data: topData.map(item => item.author) },
      series: [{
        name: metricLabels[metric].label,
        type: 'bar',
        itemStyle: { color: metricLabels[metric].color },
        label: { show: true, position: 'right' },
        data: topData.map(item => item[metric])
      }]
    };
  }, [authorRanking, metric, topN]);

  const allAuthors = useMemo(() => {
    if (!filteredStats) {
      return [];
    }
    return _.uniq(filteredStats.fullData.map(record => String(record.author))).sort();
  }, [filteredStats]);

  useEffect(() => {
    if (allAuthors.length > 0 && (!selectedAuthor || !allAuthors.includes(selectedAuthor))) {
      setSelectedAuthor(allAuthors[0]);
    }
  }, [allAuthors, selectedAuthor]);

  const authorChartOption = useMemo(() => {
    if (!filteredStats || !selectedAuthor) {
      return {};
    }
    const authorData = filteredStats.fullData.filter(record => record.author === selectedAuthor);
    const monthlyData = filteredStats.allMonths.map(month => {
      const records = authorData.filter(record => record.month === month);
      return { month, value: _.sumBy(records, metric) };
    });
    return {
      title: { text: `${selectedAuthor} 的产出趋势`, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', boundaryGap: false, data: filteredStats.allMonths },
      yAxis: { type: 'value', name: metricLabels[metric].label },
      series: [{
        name: metricLabels[metric].label,
        type: 'line',
        smooth: true,
        areaStyle: { opacity: 0.2 },
        itemStyle: { color: metricLabels[metric].color },
        data: monthlyData.map(item => item.value)
      }]
    };
  }, [filteredStats, metric, selectedAuthor]);

  const authorTableData = useMemo(() => {
    if (!filteredStats || !selectedAuthor) {
      return [];
    }
    const authorData = filteredStats.fullData.filter(record => record.author === selectedAuthor);
    return Object.entries(_.groupBy(authorData, record => `${record.month}-${record.group}-${record.project}`))
      .map(([key, records]) => ({
        key,
        month: records[0].month,
        group: records[0].group,
        project: records[0].project,
        added: _.sumBy(records, 'added'),
        deleted: _.sumBy(records, 'deleted'),
        net: _.sumBy(records, 'net'),
        commits: _.sumBy(records, 'commits')
      }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [filteredStats, selectedAuthor]);

  const targetMonthsForAnalysis = useMemo(() => {
    if (!filteredStats) {
      return [];
    }
    return monthlySelectedMonths.length > 0 ? monthlySelectedMonths : filteredStats.allMonths;
  }, [filteredStats, monthlySelectedMonths]);

  const monthlyAnalysisPivot = useMemo(() => {
    if (!filteredStats) {
      return [];
    }
    const targetAuthors = monthlySelectedAuthors.length > 0 ? monthlySelectedAuthors : allAuthors;
    const targetData = filteredStats.fullData.filter(record => targetAuthors.includes(record.author));
    return Object.entries(_.groupBy(targetData, 'author'))
      .map(([author, records]) => {
        const row: Record<string, number | string> = {
          key: author,
          author,
          total: _.sumBy(records.filter(record => targetMonthsForAnalysis.includes(record.month)), metric)
        };
        targetMonthsForAnalysis.forEach(month => {
          row[month] = _.sumBy(records.filter(record => record.month === month), metric);
        });
        return row;
      })
      .sort((a, b) => Number(b.total) - Number(a.total));
  }, [allAuthors, filteredStats, metric, monthlySelectedAuthors, targetMonthsForAnalysis]);

  const monthlyAnalysisChartOption = useMemo(() => {
    if (!filteredStats || monthlyAnalysisPivot.length === 0) {
      return {};
    }
    const displayData =
      monthlySelectedAuthors.length > 0
        ? [...monthlyAnalysisPivot].reverse()
        : [...monthlyAnalysisPivot].slice(0, 15).reverse();
    const series = targetMonthsForAnalysis.map(month => ({
      name: month,
      type: 'bar',
      stack: 'total',
      emphasis: { focus: 'series' },
      data: displayData.map(item => Number(item[month] || 0))
    }));
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: targetMonthsForAnalysis, bottom: 0 },
      xAxis: { type: 'value', name: metricLabels[metric].label },
      yAxis: { type: 'category', data: displayData.map(item => item.author) },
      series
    };
  }, [filteredStats, metric, monthlyAnalysisPivot, monthlySelectedAuthors.length, targetMonthsForAnalysis]);

  const trendOption = useMemo(() => {
    if (!filteredStats) {
      return {};
    }
    const series = filteredStats.activeGroups.map(group => ({
      name: group,
      type: 'bar',
      stack: 'total',
      emphasis: { focus: 'series' },
      data: filteredStats.groupMonthlyTrends[group]?.map(item => item[metric]) || []
    }));
    series.push({
      name: '总Commit数',
      type: 'line',
      yAxisIndex: 1,
      data: filteredStats.monthlyTrends.map(item => item.commits)
    } as any);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0 },
      xAxis: { type: 'category', data: filteredStats.allMonths },
      yAxis: [
        { type: 'value', name: metricLabels[metric].label },
        { type: 'value', name: '提交数', position: 'right' }
      ],
      series
    };
  }, [filteredStats, metric]);

  const handleAiAnalysis = async () => {
    if (!aiApiKey) {
      message.warning('请配置 API Key');
      return;
    }
    if (!filteredStats) {
      return;
    }
    setIsAiLoading(true);
    setAiAnalysis('');
    const prompt =
      `你是一位研发效能专家。指标:${metricLabels[metric].label}。数据:\n` +
      filteredStats.groupStats.map(group => `${group.group}:产出${group[metric]}`).join('\n') +
      `\nTop5:${authorRanking.slice(0, 5).map(author => `${author.author}:${author[metric]}`).join(',')}` +
      `\n请分析态势、分布、建议。使用Markdown。`;
    try {
      const response = await fetch(aiApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiApiKey}` },
        body: JSON.stringify({ model: aiModel, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await response.json();
      setAiAnalysis(data.choices?.[0]?.message?.content || '分析失败');
    } catch (error) {
      message.error(`失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleFileUpload = async (fileList: File[]) => {
    const newFiles = await Promise.all(fileList.map(async file => {
      const path = (file as any).webkitRelativePath || (file as any).path || '';
      const parts = path.split('/');
      const groupName = parts.length >= 2 ? parts[parts.length - 2] : file.name.replace('.csv', '');
      return {
        name: path || file.name,
        path,
        content: await file.text(),
        groupName
      };
    }));

    setRawFiles(previous => _.uniqBy([...previous, ...newFiles], 'name'));
    setDataSourceMode('csv');
    message.success(`已导入 ${newFiles.length} 个 CSV 文件`);
  };

  const pollRunUntilFinished = async (
    projectId: number,
    branchId: number,
    runId: number,
    silent = false
  ) => {
    if (pollingRunIdRef.current === runId) {
      return;
    }

    pollingRunIdRef.current = runId;
    setServiceBusy(true);
    if (!silent) {
      message.loading({ key: 'analysis-run', content: '正在执行分析任务...' });
    }

    try {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const run = await getRun(runId);
        setActiveRun(run);
        if (run.status === 'succeeded') {
          await refreshProjects(projectId, branchId);
          await loadLatestResult(projectId, branchId, false);
          message.success({ key: 'analysis-run', content: '分析完成，结果已加载' });
          return;
        }
        if (run.status === 'canceled') {
          await refreshProjects(projectId, branchId);
          message.warning({ key: 'analysis-run', content: '分析任务已停止' });
          return;
        }
        if (run.status === 'failed') {
          throw new Error(run.error_message || `任务状态: ${run.status}`);
        }
        await sleep(1500);
      }
      throw new Error('分析任务超时，请稍后手动刷新');
    } finally {
      if (pollingRunIdRef.current === runId) {
        pollingRunIdRef.current = null;
        setServiceBusy(false);
      }
    }
  };

  const handleCreateProject = async () => {
    if (!newGitUrl.trim()) {
      message.warning('请先输入 Git 地址');
      return;
    }
    setServiceBusy(true);
    try {
      const created = await createProject({
        name: newProjectName.trim() || undefined,
        git_url: newGitUrl.trim(),
        default_branch: newDefaultBranch.trim() || 'main'
      });
      setNewProjectName('');
      setNewGitUrl('');
      setNewDefaultBranch('main');
      setDataSourceMode('service');
      await refreshProjects(created.id, created.default_branch_record.id);
      const run = await triggerBranchUpdate(created.id, created.default_branch_record.id, false);
      await pollRunUntilFinished(created.id, created.default_branch_record.id, run.run_id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建项目失败');
    } finally {
      setServiceBusy(false);
    }
  };

  const handleCreateBranch = async () => {
    if (!selectedProjectId) {
      message.warning('请先选择项目');
      return;
    }
    if (!newBranchName.trim()) {
      message.warning('请输入分支名称');
      return;
    }
    setServiceBusy(true);
    try {
      const branch = await createBranch(selectedProjectId, {
        branch_name: newBranchName.trim(),
        is_default: false,
        analyzer_config: { max_lines: 2000 }
      });
      setNewBranchName('');
      await loadProjectContext(selectedProjectId, branch.id, false);
      setSelectedBranchId(branch.id);
      setDataSourceMode('service');
      message.success('分支已添加，请点击“更新分析”生成结果');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '新增分支失败');
    } finally {
      setServiceBusy(false);
    }
  };

  const handleProjectChange = async (projectId: number) => {
    setSelectedProjectId(projectId);
    setDataSourceMode('service');
    setServiceBusy(true);
    try {
      await loadProjectContext(projectId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载项目失败');
    } finally {
      setServiceBusy(false);
    }
  };

  const handleBranchChange = async (branchId: number) => {
    if (!selectedProjectId) {
      return;
    }
    setSelectedBranchId(branchId);
    setDataSourceMode('service');
    setServiceBusy(true);
    try {
      await loadLatestResult(selectedProjectId, branchId, false);
    } finally {
      setServiceBusy(false);
    }
  };

  const handleAnalyzeSelectedBranch = async (force: boolean) => {
    if (!selectedProjectId || !selectedBranchId) {
      message.warning('请先选择项目和分支');
      return;
    }
    setDataSourceMode('service');
    setServiceBusy(true);
    try {
      const run = await triggerBranchUpdate(selectedProjectId, selectedBranchId, force);
      await pollRunUntilFinished(selectedProjectId, selectedBranchId, run.run_id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分析任务失败');
    } finally {
      setServiceBusy(false);
    }
  };

  const handleCancelActiveRun = async () => {
    if (!activeRun || !activeRunStatuses.has(activeRun.status)) {
      return;
    }
    try {
      const run = await cancelRun(activeRun.id);
      setActiveRun(run);
      message.info('已发送停止请求，等待任务安全退出');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '停止任务失败');
    }
  };

  const handleDeleteSelectedProject = async () => {
    if (!selectedProjectId) {
      return;
    }
    if (!window.confirm(`确认彻底删除项目 ${selectedProject?.name || ''} 吗？这会删除本地缓存和分析结果。`)) {
      return;
    }
    setServiceBusy(true);
    try {
      await deleteProject(selectedProjectId);
      setRemoteStats(null);
      setActiveRun(null);
      await refreshProjects();
      message.success('项目已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除项目失败');
    } finally {
      setServiceBusy(false);
    }
  };

  const handleClearSelectedProjectCache = async () => {
    if (!selectedProjectId) {
      return;
    }
    setServiceBusy(true);
    try {
      await clearProjectCache(selectedProjectId);
      setCacheInfo(await getProjectCache(selectedProjectId));
      message.success('本地缓存已清理');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '清理缓存失败');
    } finally {
      setServiceBusy(false);
    }
  };

  const sourceDescription = useMemo(() => {
    if (dataSourceMode === 'service') {
      if (remoteStats?.projectMeta?.name && remoteStats?.branchMeta?.name) {
        return `服务结果 · ${remoteStats.projectMeta.name} / ${remoteStats.branchMeta.name}`;
      }
      return '服务结果';
    }
    if (rawFiles.length > 0) {
      return `CSV 导入 · ${rawFiles.length} 个文件`;
    }
    return 'CSV 模式';
  }, [dataSourceMode, rawFiles.length, remoteStats]);

  return (
    <Layout style={{ minHeight: '100vh', padding: '24px', background: '#f5f7f9' }}>
      <Header style={{ background: 'transparent', padding: 0, marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <Space direction="vertical" size={2}>
          <Title level={2} style={{ margin: 0 }}>研发效能深度分析看板</Title>
          <Space wrap>
            <Tag color="blue">{sourceDescription}</Tag>
            {remoteStats?.runMeta?.commitSha ? <Tag color="geekblue">Commit {remoteStats.runMeta.commitSha.slice(0, 8)}</Tag> : null}
            {activeRun ? <Tag color={runStatusColors[activeRun.status] || 'default'}>任务状态: {activeRun.status}</Tag> : null}
            {activeRun?.cancel_requested ? <Tag color="orange">停止请求已发送</Tag> : null}
          </Space>
        </Space>
        <Space size="large" wrap>
          <Segmented<DataSourceMode>
            value={dataSourceMode}
            onChange={value => setDataSourceMode(value)}
            options={[
              { label: '服务模式', value: 'service', disabled: serviceAvailable === false },
              { label: 'CSV 模式', value: 'csv' }
            ]}
          />
          <Space>
            <Text strong><FilterOutlined /> 统计工程：</Text>
            <Checkbox
              indeterminate={selectedGroups.length > 0 && selectedGroups.length < (baseStats?.allGroups.length || 0)}
              checked={selectedGroups.length === (baseStats?.allGroups.length || 0) && (baseStats?.allGroups.length || 0) > 0}
              onChange={event => setSelectedGroups(event.target.checked ? (baseStats?.allGroups || []) : [])}
              disabled={!baseStats}
            >
              全选
            </Checkbox>
            <Select
              mode="multiple"
              style={{ minWidth: 220, maxWidth: 420 }}
              value={selectedGroups}
              onChange={setSelectedGroups}
              maxTagCount="responsive"
              disabled={!baseStats}
              options={(baseStats?.allGroups || []).map(group => ({ label: group, value: group }))}
            />
          </Space>
          <Space>
            <Text strong>指标：</Text>
            <Select value={metric} onChange={setMetric} style={{ width: 110 }}>
              <Select.Option value="added">新增行数</Select.Option>
              <Select.Option value="deleted">删除行数</Select.Option>
              <Select.Option value="net">净增行数</Select.Option>
            </Select>
            <Switch checked={showUndefined} onChange={setShowUndefined} checkedChildren="显示未知" unCheckedChildren="隐藏未知" />
          </Space>
        </Space>
      </Header>

      <Content>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Card title={<span><ApiOutlined /> Git 服务模式</span>} extra={<Button icon={<ReloadOutlined />} onClick={() => bootstrapService().catch(() => undefined)} loading={serviceBusy}>刷新服务</Button>}>
            <Alert
              type={serviceAvailable === false ? 'error' : serviceAvailable ? 'success' : 'info'}
              message={serviceAvailable === false ? '后端服务不可用' : serviceAvailable ? '后端服务可用' : '正在检查后端服务'}
              description={serviceHint}
              showIcon
              style={{ marginBottom: 16 }}
            />

            <Row gutter={16}>
              <Col span={12}>
                <Card title="新增 Git 项目并立即分析" size="small" bordered={false}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Input placeholder="项目名称（可选）" value={newProjectName} onChange={event => setNewProjectName(event.target.value)} />
                    <Input placeholder="Git 地址，例如 /tmp/demo-repo 或 https://..." value={newGitUrl} onChange={event => setNewGitUrl(event.target.value)} />
                    <Input placeholder="默认分支" value={newDefaultBranch} onChange={event => setNewDefaultBranch(event.target.value)} />
                    <Button type="primary" loading={serviceBusy} onClick={handleCreateProject} disabled={serviceAvailable !== true}>
                      创建项目并开始分析
                    </Button>
                  </Space>
                </Card>
              </Col>
              <Col span={12}>
                <Card title="项目与分支管理" size="small" bordered={false}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Select
                      placeholder="选择项目"
                      value={selectedProjectId}
                      onChange={handleProjectChange}
                      options={projects.map(project => ({
                        label: `${project.name} (${project.default_branch})`,
                        value: project.id
                      }))}
                      disabled={serviceAvailable !== true || projects.length === 0}
                    />
                    <Select
                      placeholder="选择分支"
                      value={selectedBranchId}
                      onChange={handleBranchChange}
                      options={branches.map(branch => ({
                        label: branch.is_default ? `${branch.branch_name} (默认)` : branch.branch_name,
                        value: branch.id
                      }))}
                      disabled={!selectedProjectId || branches.length === 0}
                    />
                    <Space.Compact style={{ width: '100%' }}>
                      <Input placeholder="新增分支，例如 release/1.0" value={newBranchName} onChange={event => setNewBranchName(event.target.value)} />
                      <Button onClick={handleCreateBranch} disabled={!selectedProjectId || serviceAvailable !== true}>新增分支</Button>
                    </Space.Compact>
                    <Space wrap>
                      <Button type="primary" loading={serviceBusy} onClick={() => handleAnalyzeSelectedBranch(false)} disabled={!selectedProjectId || !selectedBranchId || serviceAvailable !== true}>
                        更新分析
                      </Button>
                      <Button loading={serviceBusy} onClick={() => handleAnalyzeSelectedBranch(true)} disabled={!selectedProjectId || !selectedBranchId || serviceAvailable !== true}>
                        强制重算
                      </Button>
                      <Button
                        danger
                        onClick={handleCancelActiveRun}
                        disabled={!activeRun || !activeRunStatuses.has(activeRun.status) || activeRun.cancel_requested}
                      >
                        停止分析
                      </Button>
                      <Button onClick={() => {
                        if (selectedProjectId && selectedBranchId) {
                          loadLatestResult(selectedProjectId, selectedBranchId).catch(error => {
                            message.error(error instanceof Error ? error.message : '加载结果失败');
                          });
                        }
                      }} disabled={!selectedProjectId || !selectedBranchId}>
                        加载最新结果
                      </Button>
                      <Button onClick={handleClearSelectedProjectCache} disabled={!selectedProjectId || serviceAvailable !== true}>
                        清理缓存
                      </Button>
                      <Button danger onClick={handleDeleteSelectedProject} disabled={!selectedProjectId || serviceAvailable !== true}>
                        删除项目
                      </Button>
                    </Space>
                  </Space>
                </Card>
              </Col>
            </Row>

            <Space wrap style={{ marginTop: 16 }}>
              {selectedProject ? <Tag color="blue">项目: {selectedProject.name}</Tag> : null}
              {selectedBranch ? <Tag color="cyan">分支: {selectedBranch.branch_name}</Tag> : null}
              {selectedBranch?.last_commit_sha ? <Tag color="geekblue">最近 Commit: {selectedBranch.last_commit_sha.slice(0, 8)}</Tag> : null}
              {selectedBranch?.last_analyzed_at ? <Tag color="purple">最近分析: {formatTime(selectedBranch.last_analyzed_at)}</Tag> : null}
              {cacheInfo ? <Tag color={cacheInfo.exists ? 'green' : 'default'}>缓存: {cacheInfo.exists ? formatBytes(cacheInfo.size_bytes) : '未生成'}</Tag> : null}
              {cacheInfo?.last_fetched_at ? <Tag color="gold">最近 fetch: {formatTime(cacheInfo.last_fetched_at)}</Tag> : null}
            </Space>
          </Card>

          <Row gutter={16}>
            <Col span={10}>
              <Card title="CSV 兼容模式" extra={<Button onClick={() => setDataSourceMode('csv')} disabled={!localStats}>切换到 CSV</Button>}>
                <Dragger
                  multiple
                  directory
                  accept=".csv"
                  beforeUpload={(file, fileList) => {
                    if (fileList.indexOf(file) === 0) {
                      handleFileUpload(fileList);
                    }
                    return false;
                  }}
                  showUploadList={false}
                  style={{ height: '150px' }}
                >
                  <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                  <p className="ant-upload-text">点击或拖拽 <b>CSV 文件 / 文件夹</b></p>
                </Dragger>
              </Card>
            </Col>
            <Col span={14}>
              <Card title={<span><SettingOutlined /> CSV 工程归类管理</span>} size="small" style={{ height: '214px', overflowY: 'auto' }}>
                <List
                  size="small"
                  dataSource={rawFiles}
                  locale={{ emptyText: '暂无 CSV 文件' }}
                  renderItem={file => (
                    <List.Item
                      actions={[
                        <Button
                          key={`delete-${file.name}`}
                          type="link"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => setRawFiles(previous => previous.filter(item => item.name !== file.name))}
                        />
                      ]}
                    >
                      <Space>
                        <Text code>{file.name}</Text>
                        <Input
                          size="small"
                          value={file.groupName}
                          onChange={event => setRawFiles(previous => previous.map(item => (
                            item.name === file.name ? { ...item, groupName: event.target.value } : item
                          )))}
                          style={{ width: 160 }}
                        />
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
          </Row>

          {serviceBusy && dataSourceMode === 'service' ? (
            <Card>
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Spin tip="服务处理中，请稍候..." />
              </div>
            </Card>
          ) : null}

          {filteredStats ? (
            <>
              <Row gutter={16}>
                <Col span={6}><Card><Statistic title="总新增" value={filteredStats.totalAdded} valueStyle={{ color: '#52c41a' }} /></Card></Col>
                <Col span={6}><Card><Statistic title="总净增" value={filteredStats.totalNet} valueStyle={{ color: '#1890ff' }} /></Card></Col>
                <Col span={6}><Card><Statistic title="总人数" value={filteredStats.authorCount} prefix={<UserOutlined />} /></Card></Col>
                <Col span={6}><Card><Statistic title="总提交" value={filteredStats.totalCommits} /></Card></Col>
              </Row>

              <Card title={`月度趋势对比 (${metricLabels[metric].label})`}>
                <ReactECharts option={trendOption} style={{ height: 380 }} notMerge />
              </Card>

              <Tabs type="card" items={[
                {
                  key: '1',
                  label: '工程维度',
                  children: (
                    <Card bordered={false}>
                      <Table
                        dataSource={filteredStats.groupStats}
                        size="small"
                        pagination={false}
                        rowKey={(record: any) => record.group}
                        columns={[
                          { title: '顶级工程', dataIndex: 'group' },
                          { title: '包含模块', dataIndex: 'projectCount' },
                          { title: '参与人数', dataIndex: 'authorCount' },
                          { title: `总${metricLabels[metric].label}`, dataIndex: metric, render: value => <Text strong style={{ color: metricLabels[metric].color }}>{value}</Text> }
                        ]}
                      />
                      <Table
                        dataSource={filteredStats.projectStats}
                        pagination={{ pageSize: 5 }}
                        size="small"
                        rowKey={(record: any) => record.key}
                        style={{ marginTop: 16 }}
                        columns={[
                          { title: '所属工程', dataIndex: 'group' },
                          { title: '子模块', dataIndex: 'project' },
                          { title: metricLabels[metric].label, dataIndex: metric }
                        ]}
                      />
                    </Card>
                  )
                },
                {
                  key: '2',
                  label: '人员排名',
                  children: (
                    <Card bordered={false}>
                      <Space style={{ marginBottom: 16 }}>
                        <Text strong>显示排名人数：</Text>
                        <Select
                          value={topN}
                          onChange={setTopN}
                          style={{ width: 120 }}
                          options={[
                            { label: 'Top 10', value: 10 },
                            { label: 'Top 20', value: 20 },
                            { label: 'Top 50', value: 50 },
                            { label: '全部', value: authorRanking.length || 10 }
                          ]}
                        />
                      </Space>
                      <ReactECharts option={authorRankingChartOption} style={{ height: Math.max(350, Math.min(topN, Math.max(authorRanking.length, 1)) * 30), marginBottom: 24 }} notMerge />
                      <Table
                        dataSource={authorRanking}
                        size="small"
                        rowKey={(record: any) => record.author}
                        columns={[
                          { title: '排名', render: (_, __, index) => index + 1, width: 60 },
                          { title: '作者', dataIndex: 'author' },
                          { title: `${metricLabels[metric].label}(选中范围)`, dataIndex: metric, render: value => <Text strong style={{ color: metricLabels[metric].color }}>{value}</Text> },
                          { title: '提交(选中范围)', dataIndex: 'commits' }
                        ]}
                      />
                    </Card>
                  )
                },
                {
                  key: '3',
                  label: '交叉明细',
                  children: (
                    <Card bordered={false}>
                      <Table
                        dataSource={filteredStats.authorProjectStats}
                        size="small"
                        rowKey={(record: any) => record.key}
                        columns={[
                          {
                            title: '工程',
                            dataIndex: 'group',
                            filters: _.uniq(filteredStats.authorProjectStats.map(item => item.group)).map(group => ({ text: group, value: group })),
                            onFilter: (value, record: any) => record.group === value
                          },
                          {
                            title: '模块',
                            dataIndex: 'project',
                            filterSearch: true,
                            filters: _.uniq(filteredStats.authorProjectStats.map(item => item.project)).map(project => ({ text: project, value: project })),
                            onFilter: (value, record: any) => record.project === value
                          },
                          {
                            title: '作者',
                            dataIndex: 'author',
                            filterSearch: true,
                            filters: _.uniq(filteredStats.authorProjectStats.map(item => item.author)).map(author => ({ text: author, value: author })),
                            onFilter: (value, record: any) => record.author === value
                          },
                          {
                            title: metricLabels[metric].label,
                            dataIndex: metric,
                            sorter: (a: any, b: any) => a[metric] - b[metric],
                            defaultSortOrder: 'descend'
                          }
                        ]}
                      />
                    </Card>
                  )
                },
                {
                  key: '4',
                  label: '个人明细',
                  children: (
                    <Card bordered={false}>
                      <Space style={{ marginBottom: 16 }}>
                        <Text strong>选择要查看的人员：</Text>
                        <Select
                          showSearch
                          value={selectedAuthor}
                          onChange={setSelectedAuthor}
                          style={{ width: 250 }}
                          options={allAuthors.map(author => ({ label: String(author), value: String(author) }))}
                        />
                      </Space>
                      <ReactECharts option={authorChartOption} style={{ height: 300, marginBottom: 24 }} notMerge />
                      <Table
                        dataSource={authorTableData}
                        size="small"
                        rowKey={(record: any) => record.key}
                        columns={[
                          { title: '月份', dataIndex: 'month', sorter: (a: any, b: any) => a.month.localeCompare(b.month), defaultSortOrder: 'descend' },
                          { title: '工程', dataIndex: 'group' },
                          { title: '模块', dataIndex: 'project' },
                          { title: metricLabels[metric].label, dataIndex: metric },
                          { title: '提交数', dataIndex: 'commits' }
                        ]}
                      />
                    </Card>
                  )
                },
                {
                  key: '5',
                  label: '月度对比',
                  children: (
                    <Card bordered={false}>
                      <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
                        <Space>
                          <Text strong>对比人员：</Text>
                          <Select
                            mode="multiple"
                            showSearch
                            allowClear
                            value={monthlySelectedAuthors}
                            onChange={setMonthlySelectedAuthors}
                            style={{ minWidth: 220, maxWidth: 420 }}
                            options={allAuthors.map(author => ({ label: String(author), value: String(author) }))}
                          />
                        </Space>
                        <Space style={{ marginLeft: 16 }}>
                          <Text strong>对比月份：</Text>
                          <Select
                            mode="multiple"
                            showSearch
                            allowClear
                            value={monthlySelectedMonths}
                            onChange={setMonthlySelectedMonths}
                            style={{ minWidth: 220, maxWidth: 420 }}
                            options={filteredStats.allMonths.map(month => ({ label: month, value: month }))}
                          />
                        </Space>
                      </Space>
                      <ReactECharts option={monthlyAnalysisChartOption} style={{ height: Math.max(350, (monthlySelectedAuthors.length || 15) * 35), marginBottom: 24 }} notMerge />
                      <Table
                        dataSource={monthlyAnalysisPivot}
                        size="small"
                        rowKey={(record: any) => String(record.key)}
                        scroll={{ x: 'max-content' }}
                        columns={[
                          { title: '作者', dataIndex: 'author', fixed: 'left' },
                          ...targetMonthsForAnalysis.map(month => ({
                            title: month,
                            dataIndex: month,
                            render: (value: any) => value || '-',
                            sorter: (a: any, b: any) => Number(a[month] || 0) - Number(b[month] || 0)
                          })),
                          {
                            title: `总计 (${metricLabels[metric].label})`,
                            dataIndex: 'total',
                            fixed: 'right',
                            render: value => <Text strong style={{ color: metricLabels[metric].color }}>{value}</Text>,
                            sorter: (a: any, b: any) => Number(a.total) - Number(b.total),
                            defaultSortOrder: 'descend'
                          }
                        ]}
                      />
                    </Card>
                  )
                },
                {
                  key: '6',
                  label: 'AI分析',
                  children: (
                    <Card bordered={false}>
                      <Row gutter={24}>
                        <Col span={8}>
                          <Card title="AI 配置与范围" size="small">
                            <Space direction="vertical" style={{ width: '100%' }}>
                              <Text strong>1. 基础配置</Text>
                              <Input.Password placeholder="API Key" value={aiApiKey} onChange={event => setAiApiKey(event.target.value)} />
                              <Input placeholder="API Endpoint" value={aiApiUrl} onChange={event => setAiApiUrl(event.target.value)} />
                              <Input placeholder="模型名称" value={aiModel} onChange={event => setAiApiModel(event.target.value)} />
                              <Button
                                block
                                size="small"
                                onClick={() => {
                                  localStorage.setItem('ai_api_key', aiApiKey);
                                  localStorage.setItem('ai_api_url', aiApiUrl);
                                  localStorage.setItem('ai_model', aiModel);
                                  message.success('已保存');
                                }}
                              >
                                保存配置
                              </Button>

                              <Text strong style={{ marginTop: 12, display: 'block' }}>2. 分析范围</Text>
                              <Select
                                style={{ width: '100%' }}
                                value={aiAnalysisMode}
                                onChange={value => {
                                  setAiAnalysisMode(value);
                                  setAiTargetItems([]);
                                }}
                                options={[
                                  { label: '全工程概览', value: 'overview' },
                                  { label: '特定工程深度分析', value: 'project' },
                                  { label: '特定人员效能评估', value: 'author' }
                                ]}
                              />

                              {aiAnalysisMode !== 'overview' ? (
                                <Select
                                  mode="multiple"
                                  style={{ width: '100%' }}
                                  placeholder={aiAnalysisMode === 'project' ? '选择要分析的工程' : '选择要分析的人员'}
                                  value={aiTargetItems}
                                  onChange={setAiTargetItems}
                                  options={aiAnalysisMode === 'project'
                                    ? filteredStats.activeGroups.map(group => ({ label: group, value: group }))
                                    : allAuthors.map(author => ({ label: String(author), value: String(author) }))}
                                />
                              ) : null}

                              <Text strong style={{ marginTop: 12, display: 'block' }}>3. 自定义关注焦点 (可选)</Text>
                              <Input.TextArea
                                rows={3}
                                placeholder="例如：分析2月产出下滑原因、评价核心人员稳定性等"
                                value={aiCustomFocus}
                                onChange={event => setAiCustomFocus(event.target.value)}
                              />

                              <Button block type="primary" icon={<RobotOutlined />} loading={isAiLoading} onClick={handleAiAnalysis} style={{ marginTop: 16 }}>
                                开始智能分析
                              </Button>
                            </Space>
                          </Card>
                        </Col>
                        <Col span={16}>
                          <Card title="AI 分析报告" size="small" style={{ minHeight: '500px' }}>
                            {isAiLoading ? (
                              <div style={{ textAlign: 'center', marginTop: 150 }}>
                                <Spin size="large" tip="AI 正在深度思考中..." />
                              </div>
                            ) : aiAnalysis ? (
                              <div style={{ padding: '0 16px' }}>
                                <ReactMarkdown>{aiAnalysis}</ReactMarkdown>
                              </div>
                            ) : (
                              <div style={{ textAlign: 'center', marginTop: 150 }}>
                                <Text type="secondary">配置参数并点击左侧按钮开始分析</Text>
                              </div>
                            )}
                          </Card>
                        </Col>
                      </Row>
                    </Card>
                  )
                }
              ]} />
            </>
          ) : (
            <Card>
              <div style={{ textAlign: 'center', padding: '100px 0' }}>
                <Text type="secondary">
                  {dataSourceMode === 'service'
                    ? '请选择项目分支并执行分析，或先创建一个新的 Git 项目。'
                    : '请上传 CSV 文件，或切换到服务模式从 Git 仓库直接分析。'}
                </Text>
              </div>
            </Card>
          )}
        </Space>
      </Content>
    </Layout>
  );
};

export default App;
