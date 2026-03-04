import React, { useState, useMemo, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { 
  Layout, Upload, Card, Row, Col, Statistic, Table, Typography, Space, message, Select, Input, Tabs, Button, List, Checkbox, Switch, Spin 
} from 'antd';
import { 
  InboxOutlined, UserOutlined, SettingOutlined, DeleteOutlined, FilterOutlined, RobotOutlined, 
  LineChartOutlined, DeploymentUnitOutlined 
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import _ from 'lodash';
import { processCSVFiles, AggregatedStats, FileInfo } from './utils/dataProcessor';
import authorMapping from '../author_mapping.json';

const { Header, Content } = Layout;
const { Dragger } = Upload;
const { Title, Text } = Typography;

const App: React.FC = () => {
  const [rawFiles, setRawFiles] = useState<FileInfo[]>([]);
  const [baseStats, setBaseStats] = useState<AggregatedStats | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [metric, setMetric] = useState<'added' | 'deleted' | 'net'>('added');
  const [selectedAuthor, setSelectedAuthor] = useState<string | undefined>(undefined);
  const [showUndefined, setShowUndefined] = useState<boolean>(false);
  const [topN, setTopN] = useState<number>(10);
  const [monthlySelectedAuthors, setMonthlySelectedAuthors] = useState<string[]>([]); 
  const [monthlySelectedMonths, setMonthlySelectedMonths] = useState<string[]>([]); 

  // AI 相关状态
  const [aiApiKey, setAiApiKey] = useState<string>(localStorage.getItem('ai_api_key') || '');
  const [aiApiUrl, setAiApiUrl] = useState<string>(localStorage.getItem('ai_api_url') || 'https://api.deepseek.com/v1/chat/completions');
  const [aiModel, setAiApiModel] = useState<string>(localStorage.getItem('ai_model') || 'deepseek-chat');
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [aiAnalysisMode, setAiAnalysisMode] = useState<'overview' | 'project' | 'author'>('overview');
  const [aiTargetItems, setAiTargetItems] = useState<string[]>([]);
  const [aiCustomFocus, setAiCustomFocus] = useState<string>('');

  const metricLabels = {
    added: { label: '新增行数', color: '#52c41a' },
    deleted: { label: '删除行数', color: '#ff4d4f' },
    net: { label: '净增行数', color: '#1890ff' }
  };

  // 0. 初始自动加载本地 data 目录数据
  useEffect(() => {
    const loadLocalData = () => {
      // 仅扫描根目录下的 data 文件夹
      const defaultModules = import.meta.glob('../data/**/*.csv', { query: '?raw', import: 'default', eager: true });
      const initialFiles: FileInfo[] = [];
      
      for (const [path, content] of Object.entries(defaultModules)) {
        const pathParts = path.split('/');
        // 路径示例: ../data/ProjectA/1.csv -> pathParts = ['', '..', 'data', 'ProjectA', '1.csv']
        // 我们取 data 文件夹后的第一个文件夹名
        const groupName = pathParts.length >= 4 ? pathParts[pathParts.indexOf('data') + 1] : '默认工程';
        
        initialFiles.push({
          name: path.replace('../data/', ''), 
          path,
          content: content as string,
          groupName: groupName
        });
      }

      if (initialFiles.length > 0) {
        setRawFiles(initialFiles);
        message.success(`已从 data 目录自动加载了 ${initialFiles.length} 个分析文件`);
      }
    };
    loadLocalData();
  }, []);

  // 1. 基础解析逻辑
  useEffect(() => {
    if (rawFiles.length > 0) {
      processCSVFiles(rawFiles, authorMapping).then(res => {
        setBaseStats(res);
        const initialGroups = res.allGroups.filter(g => {
          if (!showUndefined) {
            const s = String(g).toLowerCase();
            return s !== 'undefined' && s !== 'null' && s !== '未知' && s !== '';
          }
          return true;
        });
        setSelectedGroups(initialGroups);
      });
    } else {
      setBaseStats(null);
      setSelectedGroups([]);
    }
  }, [rawFiles, showUndefined]);

  // 2. 核心：全局过滤后的数据
  const filteredStats = useMemo(() => {
    if (!baseStats || selectedGroups.length === 0) return null;

    const filteredFullData = baseStats.fullData.filter(r => {
      if (!selectedGroups.includes(r.group)) return false;
      if (!showUndefined) {
        const isUndef = (val: any) => {
          const s = String(val).trim().toLowerCase();
          return !val || s === 'undefined' || s === 'null' || s === '未知' || s === '-' || s === '总计' || s === '';
        };
        if (isUndef(r.author) || isUndef(r.project) || isUndef(r.group) || isUndef(r.month)) return false;
      }
      return true;
    });

    const activeMonths = _.uniq(filteredFullData.map(r => String(r.month))).sort();
    const activeGroups = _.uniq(filteredFullData.map(r => r.group));

    const monthlyTrends = activeMonths.map(month => {
      const records = filteredFullData.filter(r => String(r.month) === month);
      return {
        month,
        added: _.sumBy(records, 'added'),
        deleted: _.sumBy(records, 'deleted'),
        net: _.sumBy(records, 'net'),
        commits: _.sumBy(records, 'commits'),
      };
    });

    const groupMonthlyTrends: Record<string, any[]> = {};
    activeGroups.forEach(group => {
      groupMonthlyTrends[group] = activeMonths.map(month => {
        const records = filteredFullData.filter(r => r.group === group && String(r.month) === month);
        return { month, added: _.sumBy(records, 'added'), deleted: _.sumBy(records, 'deleted'), net: _.sumBy(records, 'net'), commits: _.sumBy(records, 'commits') };
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
      groupStats: baseStats.groupStats.filter(g => activeGroups.includes(g.group)),
      projectStats: baseStats.projectStats.filter(p => activeGroups.includes(p.group)),
      authorProjectStats: baseStats.authorProjectStats.filter(ap => activeGroups.includes(ap.group))
    };
  }, [baseStats, selectedGroups, showUndefined]);

  // 3. 计算人员排名
  const authorRanking = useMemo(() => {
    if (!filteredStats) return [];
    const grouped = _.groupBy(filteredStats.fullData, 'author');
    return Object.entries(grouped).map(([author, records]) => ({
      author,
      added: _.sumBy(records, 'added'),
      deleted: _.sumBy(records, 'deleted'),
      net: _.sumBy(records, 'net'),
      commits: _.sumBy(records, 'commits'),
    })).sort((a, b) => b[metric] - a[metric]);
  }, [filteredStats, metric]);

  const authorRankingChartOption = useMemo(() => {
    if (!authorRanking || authorRanking.length === 0) return {};
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

  // 4. 个人明细
  const allAuthors = useMemo(() => {
    if (!filteredStats) return [];
    return _.uniq(filteredStats.fullData.map(r => String(r.author))).sort();
  }, [filteredStats]);

  useEffect(() => {
    if (allAuthors.length > 0 && (!selectedAuthor || !allAuthors.includes(selectedAuthor))) {
      setSelectedAuthor(allAuthors[0]);
    }
  }, [allAuthors, selectedAuthor]);

  const authorChartOption = useMemo(() => {
    if (!filteredStats || !selectedAuthor) return {};
    const authorData = filteredStats.fullData.filter(r => r.author === selectedAuthor);
    const monthlyData = filteredStats.allMonths.map(month => {
      const records = authorData.filter(r => r.month === month);
      return { month, value: _.sumBy(records, metric) };
    });
    return {
      title: { text: `${selectedAuthor} 的产出趋势`, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', boundaryGap: false, data: filteredStats.allMonths },
      yAxis: { type: 'value', name: metricLabels[metric].label },
      series: [{
        name: metricLabels[metric].label, type: 'line', smooth: true, areaStyle: { opacity: 0.2 },
        itemStyle: { color: metricLabels[metric].color }, data: monthlyData.map(d => d.value)
      }]
    };
  }, [filteredStats, selectedAuthor, metric]);

  const authorTableData = useMemo(() => {
    if (!filteredStats || !selectedAuthor) return [];
    const authorData = filteredStats.fullData.filter(r => r.author === selectedAuthor);
    return Object.entries(_.groupBy(authorData, r => `${r.month}-${r.group}-${r.project}`)).map(([key, records]) => ({
      key,
      month: records[0].month,
      group: records[0].group,
      project: records[0].project,
      added: _.sumBy(records, 'added'),
      deleted: _.sumBy(records, 'deleted'),
      net: _.sumBy(records, 'net'),
      commits: _.sumBy(records, 'commits'),
    })).sort((a, b) => b.month.localeCompare(a.month));
  }, [filteredStats, selectedAuthor]);

  // 5. 月度横向对比
  const targetMonthsForAnalysis = useMemo(() => {
    if (!filteredStats) return [];
    return monthlySelectedMonths.length > 0 ? monthlySelectedMonths : filteredStats.allMonths;
  }, [filteredStats, monthlySelectedMonths]);

  const monthlyAnalysisPivot = useMemo(() => {
    if (!filteredStats) return [];
    const targetAuthors = monthlySelectedAuthors.length > 0 ? monthlySelectedAuthors : allAuthors;
    const targetData = filteredStats.fullData.filter(r => targetAuthors.includes(r.author));
    return Object.entries(_.groupBy(targetData, 'author')).map(([author, records]) => {
      const row: any = {
        key: author, author,
        total: _.sumBy(records.filter(r => targetMonthsForAnalysis.includes(r.month)), metric)
      };
      targetMonthsForAnalysis.forEach(month => {
        row[month] = _.sumBy(records.filter(r => r.month === month), metric);
      });
      return row;
    }).sort((a, b) => b.total - a.total);
  }, [filteredStats, monthlySelectedAuthors, targetMonthsForAnalysis, metric, allAuthors]);

  const monthlyAnalysisChartOption = useMemo(() => {
    if (!filteredStats || monthlyAnalysisPivot.length === 0) return {};
    const displayData = monthlySelectedAuthors.length > 0 ? [...monthlyAnalysisPivot].reverse() : [...monthlyAnalysisPivot].slice(0, 15).reverse();
    const series = targetMonthsForAnalysis.map(month => ({
      name: month, type: 'bar', stack: 'total', emphasis: { focus: 'series' },
      data: displayData.map((d: any) => d[month] || 0)
    }));
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: targetMonthsForAnalysis, bottom: 0 },
      xAxis: { type: 'value', name: metricLabels[metric].label },
      yAxis: { type: 'category', data: displayData.map(d => d.author) },
      series
    };
  }, [monthlyAnalysisPivot, targetMonthsForAnalysis, metric, monthlySelectedAuthors]);

  // 6. AI 分析
  const handleAiAnalysis = async () => {
    if (!aiApiKey) { message.warning('请配置 API Key'); return; }
    if (!filteredStats) return;
    setIsAiLoading(true); setAiAnalysis('');
    const prompt = `你是一位研发效能专家。指标:${metricLabels[metric].label}。数据:\n` + 
      filteredStats.groupStats.map(g => `${g.group}:产出${g[metric]}`).join('\n') + 
      `Top5:${authorRanking.slice(0, 5).map(a => `${a.author}:${a[metric]}`).join(',')}\n请分析态势、分布、建议。使用Markdown。`;
    try {
      const response = await fetch(aiApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiApiKey}` },
        body: JSON.stringify({ model: aiModel, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await response.json();
      setAiAnalysis(data.choices?.[0]?.message?.content || '分析失败');
    } catch (err: any) { message.error(`失败: ${err.message}`); } finally { setIsAiLoading(false); }
  };

  const handleFileUpload = async (fileList: File[]) => {
    const newFiles = await Promise.all(fileList.map(async (f) => {
      const path = (f as any).webkitRelativePath || (f as any).path || '';
      const parts = path.split('/');
      const group = parts.length >= 2 ? parts[parts.length - 2] : f.name.replace('.csv','');
      return { name: path || f.name, path, content: await f.text(), groupName: group };
    }));
    setRawFiles(prev => _.uniqBy([...prev, ...newFiles], 'name'));
  };

  const trendOption = useMemo(() => {
    if (!filteredStats) return {};
    const series = filteredStats.activeGroups.map(group => ({
      name: group, type: 'bar', stack: 'total', emphasis: { focus: 'series' },
      data: filteredStats.groupMonthlyTrends[group]?.map(t => t[metric]) || []
    }));
    series.push({ name: '总Commit数', type: 'line', yAxisIndex: 1, data: filteredStats.monthlyTrends.map(t => t.commits) } as any);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0 },
      xAxis: { type: 'category', data: filteredStats.allMonths },
      yAxis: [{ type: 'value', name: metricLabels[metric].label }, { type: 'value', name: '提交数', position: 'right' }],
      series
    };
  }, [filteredStats, metric]);

  return (
    <Layout style={{ minHeight: '100vh', padding: '24px', background: '#f5f7f9' }}>
      <Header style={{ background: 'transparent', padding: 0, marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={2} style={{ margin: 0 }}>研发效能深度分析看板</Title>
        <Space size="large">
          <Space>
            <Text strong><FilterOutlined /> 统计工程：</Text>
            <Checkbox 
              indeterminate={selectedGroups.length > 0 && selectedGroups.length < (baseStats?.allGroups.length || 0)}
              checked={selectedGroups.length === (baseStats?.allGroups.length || 0) && (baseStats?.allGroups.length || 0) > 0}
              onChange={e => setSelectedGroups(e.target.checked ? (baseStats?.allGroups || []) : [])}
            >全选</Checkbox>
            <Select mode="multiple" style={{ minWidth: 200, maxWidth: 400 }} value={selectedGroups} onChange={setSelectedGroups} maxTagCount="responsive">
              {baseStats?.allGroups.map(g => <Select.Option key={g} value={g}>{g}</Select.Option>)}
            </Select>
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
          <Row gutter={16}>
            <Col span={10}>
              <Dragger multiple directory accept=".csv" beforeUpload={(f, list) => { if (list.indexOf(f) === 0) handleFileUpload(list); return false; }} showUploadList={false} style={{ height: '150px' }}>
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">点击或拖拽 <b>文件 / 文件夹</b></p>
              </Dragger>
            </Col>
            <Col span={14}>
              <Card title={<span><SettingOutlined /> 工程归类管理</span>} size="small" style={{ height: '150px', overflowY: 'auto' }}>
                <List size="small" dataSource={rawFiles} renderItem={file => (
                  <List.Item actions={[<Button type="link" danger icon={<DeleteOutlined />} onClick={() => setRawFiles(prev => prev.filter(f => f.name !== file.name))} />]}>
                    <Space><Text code>{file.name}</Text><Input size="small" value={file.groupName} onChange={e => setRawFiles(prev => prev.map(f => f.name === file.name ? { ...f, groupName: e.target.value } : f))} style={{ width: 140 }} /></Space>
                  </List.Item>
                )} />
              </Card>
            </Col>
          </Row>

          {filteredStats ? (
            <>
              <Row gutter={16}>
                <Col span={6}><Card><Statistic title="总新增" value={filteredStats.totalAdded} valueStyle={{ color: '#52c41a' }} /></Card></Col>
                <Col span={6}><Card><Statistic title="总净增" value={filteredStats.totalNet} valueStyle={{ color: '#1890ff' }} /></Card></Col>
                <Col span={6}><Card><Statistic title="总人数" value={filteredStats.authorCount} prefix={<UserOutlined />} /></Card></Col>
                <Col span={6}><Card><Statistic title="总提交" value={filteredStats.totalCommits} /></Card></Col>
              </Row>

              <Card title={`月度趋势对比 (${metricLabels[metric].label})`}><ReactECharts option={trendOption} style={{ height: 380 }} notMerge={true} /></Card>

              <Tabs type="card" items={[
                { key: '1', label: '工程维度', children: (
                  <Card bordered={false}>
                    <Table dataSource={filteredStats.groupStats} size="small" columns={[
                      { title: '顶级工程', dataIndex: 'group' },
                      { title: '包含模块', dataIndex: 'projectCount' },
                      { title: '参与人数', dataIndex: 'authorCount' },
                      { title: `总${metricLabels[metric].label}`, dataIndex: metric, render: v => <Text strong style={{ color: metricLabels[metric].color }}>{v}</Text> }
                    ]} pagination={false} />
                    <Table dataSource={filteredStats.projectStats} pagination={{ pageSize: 5 }} size="small" style={{ marginTop: 16 }} columns={[
                      { title: '所属工程', dataIndex: 'group' },
                      { title: '子模块', dataIndex: 'project' },
                      { title: metricLabels[metric].label, dataIndex: metric }
                    ]} />
                  </Card>
                )},
                { key: '2', label: '人员排名', children: (
                  <Card bordered={false}>
                    <Space style={{ marginBottom: 16 }}><Text strong>显示排名人数：</Text>
                      <Select value={topN} onChange={setTopN} style={{ width: 120 }} options={[{ label: 'Top 10', value: 10 }, { label: 'Top 20', value: 20 }, { label: 'Top 50', value: 50 }, { label: '全部', value: authorRanking.length }]} />
                    </Space>
                    <ReactECharts option={authorRankingChartOption} style={{ height: Math.max(350, Math.min(topN, authorRanking.length) * 30), marginBottom: 24 }} notMerge={true} />
                    <Table dataSource={authorRanking} size="small" columns={[
                      { title: '排名', render: (_1, _2, index) => index + 1, width: 60 },
                      { title: '作者', dataIndex: 'author' },
                      { title: `${metricLabels[metric].label}(选中范围)`, dataIndex: metric, render: v => <Text strong style={{ color: metricLabels[metric].color }}>{v}</Text> },
                      { title: '提交(选中范围)', dataIndex: 'commits' }
                    ]} />
                  </Card>
                )},
                { key: '3', label: '交叉明细', children: (
                  <Card bordered={false}>
                    <Table dataSource={filteredStats.authorProjectStats} size="small" columns={[
                      { title: '工程', dataIndex: 'group', filters: _.uniq(filteredStats.authorProjectStats.map(s => s.group)).map(g => ({ text: g, value: g })), onFilter: (v, r) => r.group === v },
                      { title: '模块', dataIndex: 'project', filterSearch: true, filters: _.uniq(filteredStats.authorProjectStats.map(s => s.project)).map(p => ({ text: p, value: p })), onFilter: (v, r) => r.project === v },
                      { title: '作者', dataIndex: 'author', filterSearch: true, filters: _.uniq(filteredStats.authorProjectStats.map(s => s.author)).map(a => ({ text: a, value: a })), onFilter: (v, r) => r.author === v },
                      { title: metricLabels[metric].label, dataIndex: metric, sorter: (a: any, b: any) => a[metric] - b[metric], defaultSortOrder: 'descend' }
                    ]} />
                  </Card>
                )},
                { key: '4', label: '个人明细', children: (
                  <Card bordered={false}>
                    <Space style={{ marginBottom: 16 }}><Text strong>选择要查看的人员：</Text>
                      <Select showSearch value={selectedAuthor} onChange={setSelectedAuthor} style={{ width: 250 }} options={allAuthors.map(a => ({ label: String(a), value: String(a) }))} />
                    </Space>
                    <ReactECharts option={authorChartOption} style={{ height: 300, marginBottom: 24 }} notMerge={true} />
                    <Table dataSource={authorTableData} size="small" columns={[
                      { title: '月份', dataIndex: 'month', sorter: (a: any, b: any) => a.month.localeCompare(b.month), defaultSortOrder: 'descend' },
                      { title: '工程', dataIndex: 'group' }, { title: '模块', dataIndex: 'project' },
                      { title: metricLabels[metric].label, dataIndex: metric }, { title: '提交数', dataIndex: 'commits' }
                    ]} />
                  </Card>
                )},
                { key: '5', label: '月度对比', children: (
                  <Card bordered={false}>
                    <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
                      <Space><Text strong>对比人员：</Text><Select mode="multiple" showSearch allowClear value={monthlySelectedAuthors} onChange={setMonthlySelectedAuthors} style={{ minWidth: 200, maxWidth: 400 }} options={allAuthors.map(a => ({ label: String(a), value: String(a) }))} /></Space>
                      <Space style={{ marginLeft: 16 }}><Text strong>对比月份：</Text><Select mode="multiple" showSearch allowClear value={monthlySelectedMonths} onChange={setMonthlySelectedMonths} style={{ minWidth: 200, maxWidth: 400 }} options={filteredStats?.allMonths.map(m => ({ label: m, value: m }))} /></Space>
                    </Space>
                    <ReactECharts option={monthlyAnalysisChartOption} style={{ height: Math.max(350, (monthlySelectedAuthors.length || 15) * 35), marginBottom: 24 }} notMerge={true} />
                    <Table dataSource={monthlyAnalysisPivot} size="small" scroll={{ x: 'max-content' }} columns={[
                      { title: '作者', dataIndex: 'author', fixed: 'left' },
                      ...targetMonthsForAnalysis.map(month => ({ title: month, dataIndex: month, render: (v: any) => v || '-', sorter: (a: any, b: any) => (a[month] || 0) - (b[month] || 0) })),
                      { title: `总计 (${metricLabels[metric].label})`, dataIndex: 'total', fixed: 'right', render: v => <Text strong style={{ color: metricLabels[metric].color }}>{v}</Text>, sorter: (a: any, b: any) => a.total - b.total, defaultSortOrder: 'descend' }
                    ]} />
                  </Card>
                )},
                { key: '6', label: 'AI分析', children: (
                  <Card bordered={false}>
                    <Row gutter={24}>
                      <Col span={8}>
                        <Card title="AI 配置与范围" size="small">
                          <Space direction="vertical" style={{ width: '100%' }}>
                            <Text strong>1. 基础配置</Text>
                            <Input.Password placeholder="API Key" value={aiApiKey} onChange={e => setAiApiKey(e.target.value)} />
                            <Input placeholder="API Endpoint" value={aiApiUrl} onChange={e => setAiApiUrl(e.target.value)} />
                            <Input placeholder="模型名称" value={aiModel} onChange={e => setAiApiModel(e.target.value)} />
                            <Button block size="small" onClick={() => { localStorage.setItem('ai_api_key', aiApiKey); localStorage.setItem('ai_api_url', aiApiUrl); localStorage.setItem('ai_model', aiModel); message.success('已保存'); }}>保存配置</Button>
                            
                            <Text strong style={{ marginTop: 12, display: 'block' }}>2. 分析范围</Text>
                            <Select 
                              style={{ width: '100%' }} 
                              value={aiAnalysisMode} 
                              onChange={(val) => { setAiAnalysisMode(val); setAiTargetItems([]); }}
                              options={[
                                { label: '全工程概览', value: 'overview' },
                                { label: '特定工程深度分析', value: 'project' },
                                { label: '特定人员效能评估', value: 'author' }
                              ]}
                            />
                            
                            {aiAnalysisMode !== 'overview' && (
                              <Select
                                mode="multiple"
                                style={{ width: '100%' }}
                                placeholder={aiAnalysisMode === 'project' ? "选择要分析的工程" : "选择要分析的人员"}
                                value={aiTargetItems}
                                onChange={setAiTargetItems}
                                options={aiAnalysisMode === 'project' ? 
                                  filteredStats.activeGroups.map(g => ({ label: g, value: g })) : 
                                  allAuthors.map(a => ({ label: String(a), value: String(a) }))
                                }
                              />
                            )}

                            <Text strong style={{ marginTop: 12, display: 'block' }}>3. 自定义关注焦点 (可选)</Text>
                            <Input.TextArea 
                              rows={3} 
                              placeholder="例如：分析2月产出下滑原因、评价核心人员稳定性等" 
                              value={aiCustomFocus}
                              onChange={e => setAiCustomFocus(e.target.value)}
                            />

                            <Button 
                              block 
                              type="primary" 
                              icon={<RobotOutlined />} 
                              loading={isAiLoading} 
                              onClick={handleAiAnalysis} 
                              style={{ marginTop: 16 }}
                            >
                              开始智能分析
                            </Button>
                          </Space>
                        </Card>
                      </Col>
                      <Col span={16}>
                        <Card title="AI 分析报告" size="small" style={{ minHeight: '500px' }}>
                          {isAiLoading ? <div style={{ textAlign: 'center', marginTop: 150 }}><Spin size="large" tip="AI 正在深度思考中..." /></div> : 
                           aiAnalysis ? <div style={{ padding: '0 16px' }}><ReactMarkdown>{aiAnalysis}</ReactMarkdown></div> : 
                           <div style={{ textAlign: 'center', marginTop: 150 }}><Text type="secondary">配置参数并点击左侧按钮开始分析</Text></div>}
                        </Card>
                      </Col>
                    </Row>
                  </Card>
                )}
              ]} />
            </>
          ) : <div style={{ textAlign: 'center', padding: '100px', background: '#fff' }}><Text type="secondary">请选择至少一个统计工程</Text></div>}
        </Space>
      </Content>
    </Layout>
  );
};

export default App;
