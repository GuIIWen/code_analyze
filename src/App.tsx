import React, { useState, useMemo, useEffect } from 'react';
import { 
  Layout, Upload, Card, Row, Col, Statistic, Table, Typography, Space, message, Select, Input, Tabs, Button, List, Checkbox, Switch
} from 'antd';
import { InboxOutlined, UserOutlined, SettingOutlined, DeleteOutlined, FilterOutlined } from '@ant-design/icons';
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
  const [monthlySelectedAuthors, setMonthlySelectedAuthors] = useState<string[]>([]); // 月度分析选中的人
  const [monthlySelectedMonths, setMonthlySelectedMonths] = useState<string[]>([]); // 月度分析选中的月份

  const metricLabels = {
    added: { label: '新增行数', color: '#52c41a' },
    deleted: { label: '删除行数', color: '#ff4d4f' },
    net: { label: '净增行数', color: '#1890ff' }
  };

  // 0. 初始自动加载本地目录下的所有数据
  useEffect(() => {
    const loadLocalData = () => {
      // 扫描 src 的上一级目录（项目根目录）下的所有一级或二级子文件夹中的 csv，避开 node_modules
      const defaultModules = import.meta.glob('../*/*.csv', { query: '?raw', import: 'default', eager: true });
      const initialFiles: FileInfo[] = [];
      
      for (const [path, content] of Object.entries(defaultModules)) {
        if (path.includes('node_modules') || path.includes('dist')) continue;

        const fileName = path.split('/').pop() || '';
        // 获取文件最直接的父文件夹名称
        const pathParts = path.split('/');
        const parentFolder = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : '未分类';
        
        initialFiles.push({
          name: path.replace('../', ''), // 相对路径作为唯一标识
          path,
          content: content as string,
          groupName: parentFolder // 强制默认按直接父文件夹归类
        });
      }

      if (initialFiles.length > 0) {
        setRawFiles(initialFiles);
        message.success(`已自动按文件夹加载了 ${initialFiles.length} 个分析文件`);
      }
    };
    loadLocalData();
  }, []);

  // 1. 基础数据解析 (当文件变动时)
  useEffect(() => {
    if (rawFiles.length > 0) {
      // 显式传入 authorMapping 确保映射生效
      processCSVFiles(rawFiles, authorMapping).then(res => {
        setBaseStats(res);
        // 初始默认选中所有工程组（如果 showUndefined 为 false，则排除 undefined/未知 工程）
        const initialGroups = res.allGroups.filter(g => {
           if (!showUndefined) {
             const isUndef = !g || String(g).toLowerCase() === 'undefined' || g === 'null' || g === '未知';
             if (isUndef) return false;
           }
           return true;
        });
        setSelectedGroups(initialGroups);
      });
    } else {
      setBaseStats(null);
      setSelectedGroups([]);
    }
  }, [rawFiles, showUndefined]); // 依赖中加入 showUndefined，切换开关时重新初始化 selectedGroups

  // 2. 核心：根据选中的工程组实时过滤数据 (Filtered Stats)
  const filteredStats = useMemo(() => {
    if (!baseStats || selectedGroups.length === 0) return null;

    // 过滤原始数据行
    const filteredFullData = baseStats.fullData.filter(r => {
      if (!selectedGroups.includes(r.group)) return false;

      // 根据开关过滤 undefined/未知 数据
      if (!showUndefined) {
        const isUndef = (val: any) => {
          if (val === undefined || val === null) return true;
          const s = String(val).trim().toLowerCase();
          return s === '' || s === 'undefined' || s === 'null' || s === '未知' || s === '-' || s === '总计';
        };
        if (isUndef(r.author) || isUndef(r.project) || isUndef(r.group) || isUndef(r.month)) {
          return false;
        }
      }
      return true;
    });
    
    // 重新计算存在的月份（过滤掉脏数据可能导致的 undefined 月份）
    const activeMonths = _.uniq(filteredFullData.map(r => String(r.month))).sort();

    // 重新计算月度趋势 (仅包含选中工程和有效月份)
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

    // 重新计算工程组月度趋势
    const groupMonthlyTrends: { [key: string]: any[] } = {};
    const activeGroups = _.uniq(filteredFullData.map(r => r.group)); // 只保留实际有数据的组
    
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
      allMonths: activeMonths, // 覆盖 baseStats 的脏数据月份
      fullData: filteredFullData,
      // 过滤后的工程汇总表数据
      groupStats: baseStats.groupStats.filter(g => activeGroups.includes(g.group)),
      projectStats: baseStats.projectStats.filter(p => activeGroups.includes(p.group)),
      authorProjectStats: baseStats.authorProjectStats.filter(ap => activeGroups.includes(ap.group))
    };
  }, [baseStats, selectedGroups, showUndefined]);

  // 3. 计算人员排名 (基于过滤后的数据)
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

  const trendOption = useMemo(() => {
    if (!filteredStats || !filteredStats.activeGroups) return {};
    // 渲染趋势图时，仅使用过滤后实际有数据的 activeGroups
    const series = filteredStats.activeGroups.map(group => ({
      name: group,
      type: 'bar',
      stack: 'total',
      emphasis: { focus: 'series' },
      data: filteredStats.groupMonthlyTrends[group] ? filteredStats.groupMonthlyTrends[group].map(t => t[metric]) : []
    }));
    series.push({ name: '总Commit数', type: 'line', yAxisIndex: 1, data: filteredStats.monthlyTrends.map(t => t.commits) } as any);

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0 },
      xAxis: { type: 'category', data: filteredStats.allMonths },
      yAxis: [{ type: 'value', name: metricLabels[metric].label }, { type: 'value', name: '提交数', position: 'right' }],
      series: series
    };
  }, [filteredStats, metric]);

  const authorRankingChartOption = useMemo(() => {
    if (!authorRanking || authorRanking.length === 0) return {};
    // 根据用户选择的 topN 截取数据
    const topData = [...authorRanking].slice(0, topN).reverse(); // 倒序让第一名在最上面
    
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '3%', containLabel: true },
      xAxis: { type: 'value', name: metricLabels[metric].label },
      yAxis: { type: 'category', data: topData.map(item => item.author) },
      series: [
        {
          name: metricLabels[metric].label,
          type: 'bar',
          itemStyle: { color: metricLabels[metric].color },
          label: { show: true, position: 'right' },
          data: topData.map(item => item[metric])
        }
      ]
    };
  }, [authorRanking, metric, topN]);

  // 4. 个人明细页面专属数据逻辑
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
    
    // 按月分组计算选中人的总产出趋势
    const monthlyData = filteredStats.allMonths.map(month => {
      const records = authorData.filter(r => r.month === month);
      return {
        month,
        value: _.sumBy(records, metric)
      };
    });

    return {
      title: { text: `${selectedAuthor} 的产出趋势`, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '15%', containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: filteredStats.allMonths },
      yAxis: { type: 'value', name: metricLabels[metric].label },
      series: [
        {
          name: metricLabels[metric].label,
          type: 'line',
          smooth: true,
          areaStyle: { opacity: 0.2 },
          itemStyle: { color: metricLabels[metric].color },
          data: monthlyData.map(d => d.value)
        }
      ]
    };
  }, [filteredStats, selectedAuthor, metric]);

  const authorTableData = useMemo(() => {
    if (!filteredStats || !selectedAuthor) return [];
    const authorData = filteredStats.fullData.filter(r => r.author === selectedAuthor);
    // 按 月份-工程-模块 聚合展示，最新月份在最前面，防止跨度太长
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

  // 5. 新增：月度分析透视表逻辑
  const targetMonthsForAnalysis = useMemo(() => {
    if (!filteredStats) return [];
    return monthlySelectedMonths.length > 0 ? monthlySelectedMonths : filteredStats.allMonths;
  }, [filteredStats, monthlySelectedMonths]);

  const monthlyAnalysisPivot = useMemo(() => {
    if (!filteredStats) return [];
    
    const targetAuthors = monthlySelectedAuthors.length > 0 
      ? monthlySelectedAuthors 
      : allAuthors;

    const targetData = filteredStats.fullData.filter(r => targetAuthors.includes(r.author));
    
    return Object.entries(_.groupBy(targetData, 'author')).map(([author, records]) => {
      const row: any = {
        key: author,
        author,
        total: _.sumBy(records.filter(r => targetMonthsForAnalysis.includes(r.month)), metric)
      };
      
      targetMonthsForAnalysis.forEach(month => {
        const monthRecords = records.filter(r => r.month === month);
        row[month] = _.sumBy(monthRecords, metric);
      });
      return row;
    }).sort((a, b) => b.total - a.total); 
  }, [filteredStats, monthlySelectedAuthors, targetMonthsForAnalysis, metric, allAuthors]);

  const monthlyAnalysisChartOption = useMemo(() => {
    if (!filteredStats || monthlyAnalysisPivot.length === 0) return {};
    
    // 如果没选定特定人员，默认截取前 15 名以防图表过于拥挤，选定人员则全量展示
    const displayData = monthlySelectedAuthors.length > 0 
      ? [...monthlyAnalysisPivot].reverse() 
      : [...monthlyAnalysisPivot].slice(0, 15).reverse();

    const authors = displayData.map(d => d.author);
    
    const series = filteredStats.allMonths.map(month => ({
      name: month,
      type: 'bar',
      stack: 'total',
      label: { show: false }, // 内部柱子太小不适合显示文字
      emphasis: { focus: 'series' },
      data: displayData.map((d: any) => d[month] || 0)
    }));

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: filteredStats.allMonths, bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '8%', top: '3%', containLabel: true },
      xAxis: { type: 'value', name: metricLabels[metric].label },
      yAxis: { type: 'category', data: authors },
      series: series
    };
  }, [monthlyAnalysisPivot, filteredStats, metric, monthlySelectedAuthors]);

  const handleFileUpload = async (fileList: File[]) => {
    const newFiles = await Promise.all(
      fileList.map(async (f) => {
        // 支持 webkitRelativePath (浏览器原生拖拽/选择文件夹) 或 path (Electron/Node环境可能注入的属性)
        const path = (f as any).webkitRelativePath || (f as any).path || '';
        
        // 核心逻辑：如果有路径（意味着在文件夹内），取最顶层文件夹名；否则取去掉.csv的文件名
        const defaultGroup = path.includes('/') 
          ? path.split('/')[0] === '' ? path.split('/')[1] : path.split('/')[0] 
          : f.name.replace('.csv', '');

        return { name: path || f.name, path, content: await f.text(), groupName: defaultGroup };
      })
    );
    // 使用完整路径或文件名作为去重key，避免不同文件夹下的同名文件被覆盖
    setRawFiles(prev => _.uniqBy([...prev, ...newFiles], 'name'));
    message.success(`成功读取 ${newFiles.length} 个文件`);
  };

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
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedGroups(baseStats?.allGroups || []);
                } else {
                  setSelectedGroups([]);
                }
              }}
            >
              全选
            </Checkbox>
            <Select 
              mode="multiple" 
              placeholder="选择统计范围"
              style={{ minWidth: 200, maxWidth: 400 }}
              value={selectedGroups}
              onChange={setSelectedGroups}
              maxTagCount="responsive"
            >
              {baseStats?.allGroups.map(g => <Select.Option key={g} value={g}>{g}</Select.Option>)}
            </Select>
          </Space>
          <Space>
            <Text strong>分析指标：</Text>
            <Select value={metric} onChange={setMetric} style={{ width: 110 }}>
              <Select.Option value="net">净增行数</Select.Option>
              <Select.Option value="added">新增行数</Select.Option>
              <Select.Option value="deleted">删除行数</Select.Option>
            </Select>
            <Switch 
              checked={showUndefined} 
              onChange={setShowUndefined} 
              checkedChildren="显示未知" 
              unCheckedChildren="隐藏未知"
              style={{ marginLeft: 16 }}
            />
          </Space>
        </Space>
      </Header>

      <Content>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Row gutter={16}>
            <Col span={10}>
              <Dragger 
                multiple 
                directory
                accept=".csv" 
                beforeUpload={(file, fileList) => { 
                  // 只有当当前文件是列表中的第一个时，才触发批量处理，避免重复执行
                  if (fileList.indexOf(file) === 0) {
                    handleFileUpload(fileList); 
                  }
                  return false; 
                }} 
                showUploadList={false} 
                style={{ height: '150px' }}
              >
                <p className="ant-upload-drag-icon" style={{ marginBottom: 0 }}><InboxOutlined /></p>
                <p className="ant-upload-text">点击或拖拽 <b>文件 / 文件夹</b> 到此处进行分析</p>
                <p className="ant-upload-hint">自动识别文件夹名称并归类为顶级工程</p>
              </Dragger>
            </Col>
            <Col span={14}>
              <Card title={<span><SettingOutlined /> 工程归类管理 (修改工程名可实现聚合)</span>} size="small" style={{ height: '150px', overflowY: 'auto' }}>
                <List size="small" dataSource={rawFiles} renderItem={file => (
                  <List.Item actions={[<Button type="link" danger icon={<DeleteOutlined />} onClick={() => setRawFiles(prev => prev.filter(f => f.name !== file.name))} />]}>
                    <Space>
                      <Text code>{file.name}</Text>
                      <Input size="small" value={file.groupName} onChange={(e) => setRawFiles(prev => prev.map(f => f.name === file.name ? { ...f, groupName: e.target.value } : f))} style={{ width: 140 }} />
                    </Space>
                  </List.Item>
                )} />
              </Card>
            </Col>
          </Row>

          {filteredStats ? (
            <>
              <Row gutter={16}>
                <Col span={6}><Card bordered={false}><Statistic title="所选工程总新增" value={filteredStats.totalAdded} valueStyle={{ color: '#52c41a' }} /></Card></Col>
                <Col span={6}><Card bordered={false}><Statistic title="所选工程总净增" value={filteredStats.totalNet} valueStyle={{ color: '#1890ff' }} /></Card></Col>
                <Col span={6}><Card bordered={false}><Statistic title="涉及开发者" value={filteredStats.authorCount} prefix={<UserOutlined />} /></Card></Col>
                <Col span={6}><Card bordered={false}><Statistic title="总提交次数" value={filteredStats.totalCommits} /></Card></Col>
              </Row>

              <Card title={`月度趋势对比 (${metricLabels[metric].label})`} bordered={false}>
                <ReactECharts option={trendOption} style={{ height: 380 }} />
              </Card>

              <Tabs type="card" items={[
                { key: '1', label: '工程维度', children: (
                  <Card bordered={false}>
                    <Table dataSource={filteredStats.groupStats} size="small" columns={[
                      { title: '顶级工程', dataIndex: 'group', key: 'group' },
                      { title: '包含模块', dataIndex: 'projectCount', key: 'projectCount' },
                      { title: '参与人数', dataIndex: 'authorCount', key: 'authorCount' },
                      { title: `总${metricLabels[metric].label}`, dataIndex: metric, key: metric, render: (v: any) => <Text strong style={{ color: metricLabels[metric].color }}>{v}</Text> }
                    ]} pagination={false} />
                    <Table dataSource={filteredStats.projectStats} pagination={{ pageSize: 5 }} size="small" style={{ marginTop: 16 }} columns={[
                      { title: '所属工程', dataIndex: 'group', key: 'group' },
                      { title: '子模块', dataIndex: 'project', key: 'project' },
                      { title: metricLabels[metric].label, dataIndex: metric, key: metric }
                    ]} />
                  </Card>
                )},
                { key: '2', label: '人员排名', children: (
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
                          { label: '全部', value: authorRanking.length }
                        ]}
                      />
                    </Space>
                    <ReactECharts option={authorRankingChartOption} style={{ height: Math.max(350, Math.min(topN, authorRanking.length) * 30), marginBottom: 24 }} />
                    <Table dataSource={authorRanking} size="small" columns={[
                      { title: '排名', key: 'rank', render: (_1, _2, index) => index + 1, width: 60 },
                      { title: '作者', dataIndex: 'author', key: 'author' },
                      { title: `${metricLabels[metric].label}(选中范围)`, dataIndex: metric, key: metric, render: (v: any) => <Text strong style={{ color: metricLabels[metric].color }}>{v}</Text> },
                      { title: '提交(选中范围)', dataIndex: 'commits', key: 'commits' }
                    ]} />
                  </Card>
                )},
                { key: '3', label: '交叉明细', children: (
                  <Card bordered={false}>
                    <Table dataSource={filteredStats.authorProjectStats} size="small" columns={[
                      { title: '工程', dataIndex: 'group', key: 'group', filters: _.uniq(filteredStats.authorProjectStats.map(s => s.group)).map(g => ({ text: g, value: g })), onFilter: (v, r) => r.group === v },
                      { title: '模块', dataIndex: 'project', key: 'project', filterSearch: true, filters: _.uniq(filteredStats.authorProjectStats.map(s => s.project)).map(p => ({ text: p, value: p })), onFilter: (v, r) => r.project === v },
                      { title: '作者', dataIndex: 'author', key: 'author', filterSearch: true, filters: _.uniq(filteredStats.authorProjectStats.map(s => s.author)).map(a => ({ text: a, value: a })), onFilter: (v, r) => r.author === v },
                      { title: metricLabels[metric].label, dataIndex: metric, key: metric, sorter: (a: any, b: any) => a[metric] - b[metric], defaultSortOrder: 'descend' }
                    ]} />
                  </Card>
                )},
                { key: '4', label: '个人明细', children: (
                  <Card bordered={false}>
                    <Space style={{ marginBottom: 16 }}>
                      <Text strong>选择要查看的人员：</Text>
                      <Select 
                        showSearch
                        value={selectedAuthor} 
                        onChange={setSelectedAuthor} 
                        style={{ width: 250 }}
                        options={allAuthors.map(a => ({ label: String(a), value: String(a) }))}
                      />
                    </Space>
                    
                    <ReactECharts option={authorChartOption} style={{ height: 300, marginBottom: 24 }} />
                    
                    <Table 
                      dataSource={authorTableData} 
                      size="small" 
                      columns={[
                        { title: '月份', dataIndex: 'month', key: 'month', sorter: (a: any, b: any) => a.month.localeCompare(b.month), defaultSortOrder: 'descend' },
                        { title: '工程', dataIndex: 'group', key: 'group', filters: _.uniq(authorTableData.map(s => s.group)).map(g => ({ text: String(g), value: String(g) })), onFilter: (v, r) => r.group === v },
                        { title: '模块', dataIndex: 'project', key: 'project', filterSearch: true, filters: _.uniq(authorTableData.map(s => s.project)).map(p => ({ text: String(p), value: String(p) })), onFilter: (v, r) => r.project === v },
                        { title: metricLabels[metric].label, dataIndex: metric, key: metric, sorter: (a: any, b: any) => a[metric] - b[metric] },
                        { title: '提交数', dataIndex: 'commits', key: 'commits', sorter: (a: any, b: any) => a.commits - b.commits }
                      ]} 
                    />
                  </Card>
                )},
                { key: '5', label: '月度横向对比', children: (
                  <Card bordered={false}>
                    <Space style={{ marginBottom: 16, flexWrap: 'wrap' }}>
                      <Space>
                        <Text strong>点选对比人员：</Text>
                        <Select 
                          mode="multiple"
                          showSearch
                          allowClear
                          placeholder="默认展示所有人"
                          value={monthlySelectedAuthors} 
                          onChange={setMonthlySelectedAuthors} 
                          style={{ minWidth: 250, maxWidth: 400 }}
                          options={allAuthors.map(a => ({ label: String(a), value: String(a) }))}
                        />
                      </Space>
                      <Space style={{ marginLeft: 16 }}>
                        <Text strong>选择对比月份：</Text>
                        <Select 
                          mode="multiple"
                          showSearch
                          allowClear
                          placeholder="默认展示所有月份"
                          value={monthlySelectedMonths} 
                          onChange={setMonthlySelectedMonths} 
                          style={{ minWidth: 250, maxWidth: 400 }}
                          options={filteredStats?.allMonths.map(m => ({ label: m, value: m })) || []}
                        />
                      </Space>
                    </Space>
                    
                    <ReactECharts 
                      option={monthlyAnalysisChartOption} 
                      style={{ 
                        height: Math.max(350, (monthlySelectedAuthors.length || Math.min(15, monthlyAnalysisPivot.length)) * 35), 
                        marginBottom: 24 
                      }} 
                    />

                    <Table 
                      dataSource={monthlyAnalysisPivot} 
                      size="small" 
                      scroll={{ x: 'max-content' }}
                      columns={[
                        { 
                          title: '作者', 
                          dataIndex: 'author', 
                          key: 'author', 
                          fixed: 'left',
                          filterSearch: true,
                          filters: _.uniq(monthlyAnalysisPivot.map((s: any) => s.author)).map((a: any) => ({ text: String(a), value: a })), 
                          onFilter: (v, r) => r.author === v 
                        },
                        ...targetMonthsForAnalysis.map(month => ({
                          title: month,
                          dataIndex: month,
                          key: month,
                          render: (v: any) => v || <Text type="secondary">-</Text>,
                          sorter: (a: any, b: any) => (a[month] || 0) - (b[month] || 0)
                        })),
                        { 
                          title: `总计 (${metricLabels[metric].label})`, 
                          dataIndex: 'total', 
                          key: 'total', 
                          fixed: 'right',
                          render: (v: any) => <Text strong style={{ color: metricLabels[metric].color }}>{v}</Text>,
                          sorter: (a: any, b: any) => a.total - b.total,
                          defaultSortOrder: 'descend'
                        }
                      ]} 
                    />
                  </Card>
                )}
              ]} />
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '100px', background: '#fff' }}>
              <Text type="secondary">请选择至少一个统计工程以查看分析结果</Text>
            </div>
          )}
        </Space>
      </Content>
    </Layout>
  );
};

export default App;
