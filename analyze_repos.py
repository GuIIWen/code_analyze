import os
import subprocess
import csv
import datetime
import argparse
from collections import defaultdict

def run_command(cmd, cwd):
    try:
        result = subprocess.check_output(cmd, cwd=cwd, shell=True, stderr=subprocess.STDOUT)
        return result.decode('utf-8', errors='ignore')
    except Exception:
        return ""

def get_git_stats(repo_path, max_lines):
    """
    提取 Git 仓库统计数据
    """
    # 格式: COMMIT_SEP|月份|作者
    # 后面紧跟 numstat 数据
    cmd = 'git log --numstat --pretty=format:"COMMIT_SEP|%ad|%aN" --date=format:"%Y-%m"'
    output = run_command(cmd, repo_path)
    
    stats = defaultdict(lambda: {"added": 0, "deleted": 0, "commits": 0})
    
    current_commit = None
    lines = output.split('\n')
    
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
            
        if line.startswith("COMMIT_SEP|"):
            # 如果上一个提交有效，已经处理过了
            parts = line.split('|')
            month = parts[1]
            author = parts[2]
            
            # 开始处理当前 commit 的文件统计
            commit_added = 0
            commit_deleted = 0
            i += 1
            while i < len(lines) and not lines[i].startswith("COMMIT_SEP|"):
                stat_line = lines[i].strip()
                if stat_line:
                    # numstat 格式: added deleted path
                    s_parts = stat_line.split('\t')
                    if len(s_parts) >= 2:
                        try:
                            a = int(s_parts[0]) if s_parts[0] != '-' else 0
                            d = int(s_parts[1]) if s_parts[1] != '-' else 0
                            commit_added += a
                            commit_deleted += d
                        except ValueError:
                            pass
                i += 1
            
            # 过滤超大提交 (通常是代码合并、引入库、自动生成代码)
            if commit_added + commit_deleted <= max_lines:
                key = (month, author)
                stats[key]["added"] += commit_added
                stats[key]["deleted"] += commit_deleted
                stats[key]["commits"] += 1
            continue
        i += 1
        
    return stats

def main():
    parser = argparse.ArgumentParser(description="研发效能代码统计工具")
    parser.add_argument("--src", default=".", help="要分析的源码根目录")
    parser.add_argument("--dest", default="./data", help="统计结果保存目录")
    parser.add_argument("--depth", type=int, default=2, help="递归搜索深度")
    parser.add_argument("--max-lines", type=int, default=2000, help="过滤单次超过此行数的提交")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.dest):
        os.makedirs(args.dest)

    root_dir = os.path.abspath(args.src)
    top_projects = {} # 顶级工程名 -> 数据列表

    print(f"[*] 开始扫描目录: {root_dir} (深度: {args.depth})")

    for root, dirs, files in os.walk(root_dir):
        # 计算当前深度
        current_depth = root[len(root_dir):].count(os.sep)
        if current_depth > args.depth:
            continue

        if ".git" in dirs:
            repo_path = root
            sub_project_name = os.path.basename(repo_path)
            
            # 确定顶级工程名 (根目录下的第一级目录名)
            rel_path = os.path.relpath(repo_path, root_dir)
            top_level_name = rel_path.split(os.sep)[0]
            if top_level_name == ".":
                top_level_name = sub_project_name

            print(f"[+] 发现仓库: {top_level_name} -> {sub_project_name}")
            
            repo_stats = get_git_stats(repo_path, args.max_lines)
            
            if top_level_name not in top_projects:
                top_projects[top_level_name] = []
            
            for (month, author), data in repo_stats.items():
                top_projects[top_level_name].append({
                    "月份": month,
                    "作者": author,
                    "项目": sub_project_name,
                    "新增行数": data["added"],
                    "删除行数": data["deleted"],
                    "净增行数": data["added"] - data["deleted"],
                    "有效Commit数": data["commits"]
                })
            
            # 不再深入已找到的 git 仓库内部
            dirs.remove(".git")

    # 写入 CSV
    for project_name, records in top_projects.items():
        output_file = os.path.join(args.dest, f"{project_name}_stats.csv")
        if not records:
            continue
            
        with open(output_file, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=["月份", "作者", "项目", "新增行数", "删除行数", "净增行_数", "有效Commit数"])
            # 适配之前的代码逻辑
            writer.writerow({
                "月份": "月份", "作者": "作者", "项目": "项目", 
                "新增行数": "新增行数", "删除行数": "删除行数", 
                "净增行数": "净增行数", "有效Commit数": "有效Commit数"
            })
            for r in records:
                # 处理一下字段名对齐
                row = {
                    "月份": r["月份"],
                    "作者": r["作者"],
                    "项目": r["项目"],
                    "新增行数": r["新增行数"],
                    "删除行数": r["删除行_数"],
                    "净增行数": r["净增行数"],
                    "有效Commit数": r["有效Commit数"]
                }
                writer.writerow(r)
        
        print(f"[OK] 已生成统计文件: {output_file}")

if __name__ == "__main__":
    main()
