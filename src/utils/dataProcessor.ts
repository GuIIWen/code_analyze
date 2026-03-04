import Papa from 'papaparse';
import _ from 'lodash';

export interface RawRecord {
  '月份': string;
  '作者': string;
  '项目': string;
  '新增行数': string | number;
  '删除行数': string | number;
  '净增行数': string | number;
  '有效Commit数': string | number;
}

export interface CleanRecord {
  month: string;
  author: string;
  project: string; 
  group: string;   
  added: number;
  deleted: number;
  net: number;
  commits: number;
}

export interface FileInfo {
  name: string;
  path: string;
  content: string;
  groupName: string; 
}

export interface AggregatedStats {
  totalAdded: number;
  totalDeleted: number;
  totalNet: number;
  totalCommits: number;
  authorCount: number;
  fullData: CleanRecord[];
  allMonths: string[]; // 所有月份列表
  allGroups: string[]; // 所有工程组列表
  monthlyTrends: any[];
  groupMonthlyTrends: { [groupName: string]: any[] }; // 新增：按工程组细分的月度趋势
  authorProjectStats: any[];
  projectStats: any[];
  groupStats: any[];
}

export const processCSVFiles = async (files: FileInfo[], authorMapping: Record<string, string> = {}): Promise<AggregatedStats> => {
  let allRecords: CleanRecord[] = [];

  for (const file of files) {
    const results = Papa.parse<RawRecord>(file.content, {
      header: true,
      skipEmptyLines: true,
    });

    const cleaned = results.data
      .filter(r => r['项目'] && r['项目'] !== '总计')
      .map(r => {
        let originalAuthor = String(r['作者']).trim();
        const mappedAuthor = authorMapping[originalAuthor] || originalAuthor;

        return {
          month: r['月份'],
          author: mappedAuthor,
          project: r['项目'],
          group: file.groupName, 
          added: Number(r['新增行数']) || 0,
          deleted: Number(r['删除行数']) || 0,
          net: Number(r['净增行数']) || 0,
          commits: Number(r['有效Commit数']) || 0,
        };
      });
    allRecords = [...allRecords, ...cleaned];
  }

  const allMonths = _.uniq(allRecords.map(r => r.month)).sort();
  const allGroups = _.uniq(allRecords.map(r => r.group));

  // 1. 总月度趋势
  const monthlyTrends = allMonths.map(month => {
    const records = allRecords.filter(r => r.month === month);
    return {
      month,
      added: _.sumBy(records, 'added'),
      deleted: _.sumBy(records, 'deleted'),
      net: _.sumBy(records, 'net'),
      commits: _.sumBy(records, 'commits'),
    };
  });

  // 2. 按工程组细分的月度趋势
  const groupMonthlyTrends: { [groupName: string]: any[] } = {};
  allGroups.forEach(group => {
    groupMonthlyTrends[group] = allMonths.map(month => {
      const records = allRecords.filter(r => r.group === group && r.month === month);
      return {
        month,
        added: _.sumBy(records, 'added'),
        deleted: _.sumBy(records, 'deleted'),
        net: _.sumBy(records, 'net'),
        commits: _.sumBy(records, 'commits'),
      };
    });
  });

  // 交叉维度
  const authorProjectStats = Object.entries(_.groupBy(allRecords, (r) => `${r.group}-${r.project}-${r.author}`)).map(([key, records]) => ({
    key,
    group: records[0].group,
    project: records[0].project,
    author: records[0].author,
    added: _.sumBy(records, 'added'),
    deleted: _.sumBy(records, 'deleted'),
    net: _.sumBy(records, 'net'),
    commits: _.sumBy(records, 'commits'),
  }));

  // 子工程汇总
  const projectStats = Object.entries(_.groupBy(allRecords, (r) => `${r.group}-${r.project}`)).map(([key, records]) => ({
    key,
    group: records[0].group,
    project: records[0].project,
    added: _.sumBy(records, 'added'),
    deleted: _.sumBy(records, 'deleted'),
    net: _.sumBy(records, 'net'),
    commits: _.sumBy(records, 'commits'),
    authorCount: _.uniqBy(records, 'author').length,
  })).sort((a, b) => b.net - a.net);

  // 顶级工程汇总
  const groupStats = Object.entries(_.groupBy(allRecords, 'group')).map(([group, records]) => ({
    group,
    added: _.sumBy(records, 'added'),
    deleted: _.sumBy(records, 'deleted'),
    net: _.sumBy(records, 'net'),
    commits: _.sumBy(records, 'commits'),
    projectCount: _.uniqBy(records, 'project').length,
    authorCount: _.uniqBy(records, 'author').length,
  })).sort((a, b) => b.net - a.net);

  return {
    totalAdded: _.sumBy(allRecords, 'added'),
    totalDeleted: _.sumBy(allRecords, 'deleted'),
    totalNet: _.sumBy(allRecords, 'net'),
    totalCommits: _.sumBy(allRecords, 'commits'),
    authorCount: _.uniqBy(allRecords, 'author').length,
    fullData: allRecords,
    allMonths,
    allGroups,
    monthlyTrends,
    groupMonthlyTrends,
    authorProjectStats,
    projectStats,
    groupStats,
  };
};
