# 备份说明

## 备份了什么
| 内容 | 在哪里备份 | 文件名 |
|---|---|---|
| 整个 MySQL 数据库（房源、账单、租客、单位、SIM、管理员……） | 服务器 `/root/backups/db/` | `db-年月日-时分秒.sql.gz` |
| 上传的房源图片（`uploads/`）和租约合同（`private-files/`） | 服务器 `/root/backups/files/` | `files-年月日-时分秒.tar.gz` |

- 服务器每天 **03:17（马来西亚时间）** 自动备份一次，**保留 14 天**，更旧的自动删除。
- 只有备份成功并检查过之后才会删除旧的；备份失败的话旧的一份都不会动，并在 `/root/backups/backup.log` 写下原因。
- 备份文件夹只有 root 能读（里面有租客护照和合同）。
- 你的 Mac 用 `scripts/pull-backups.sh` 把服务器的备份拉到 `~/Backups/mboutiquehomes/`，只增加、不会删掉你电脑上已有的，Mac 上保留 90 天。

## 第一次安装（在你的电脑终端运行一次）
安装每天的自动备份，并立刻做第一份：

```
ssh root@216.219.95.253 "bash /var/www/mboutiquehomes/scripts/backup.sh && (crontab -l 2>/dev/null | grep -v 'scripts/backup.sh'; echo '17 19 * * * bash /var/www/mboutiquehomes/scripts/backup.sh >> /root/backups/backup.log 2>&1') | crontab -"
```
（服务器时间是 UTC，`19:17 UTC` = 马来西亚凌晨 `03:17`。）

## 拉到你的 Mac
手动拉一次：
```
bash "/Users/admin/Documents/Portfolio Website/scripts/pull-backups.sh"
```
让 Mac 每天自动拉（电脑睡眠时，醒来后会补拉）。macOS 不让后台任务读「文档」文件夹，所以要先把脚本复制到 `~/Backups/`：
```
cp "/Users/admin/Documents/Portfolio Website/scripts/pull-backups.sh" ~/Backups/ && chmod 700 ~/Backups/pull-backups.sh
```
再安装：
```
cp "/Users/admin/Documents/Portfolio Website/scripts/com.mboutiquehomes.pull-backups.plist" ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mboutiquehomes.pull-backups.plist
```
关掉自动拉：`launchctl bootout gui/$(id -u)/com.mboutiquehomes.pull-backups`

## 怎么还原（先在一个新库里还原，确认没问题再决定要不要替换线上）
数据库：
```
gzip -dc db-20261103-031700.sql.gz | mysql -u 用户名 -p 新的空数据库名
```
图片和合同：
```
tar -xzf files-20261103-031700.tar.gz -C 某个文件夹
```
解开后里面有 `uploads/` 和 `private-files/` 两个文件夹。

## 检查备份还在不在跑
- 服务器：`ssh root@216.219.95.253 "tail -n 5 /root/backups/backup.log"`
- Mac：运行 `pull-backups.sh` 时，如果最新的备份超过 36 小时，会提示 ⚠。
