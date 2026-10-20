# 销售获客常用 Composio 工具速查

> slug 不确认时，永远先 `node search.mjs "<英文用途>"` 或让 Agent 搜索，不要凭记忆硬写。

## Gmail（已连接：wch887292@gmail.com）
| slug | 用途 | 关键参数 |
| :-- | :-- | :-- |
| GMAIL_SEND_EMAIL | 直接发信（不可逆） | recipient_email / subject / body / is_html / cc[] / bcc[] |
| GMAIL_CREATE_EMAIL_DRAFT | 建草稿（推荐先审后发） | to / subject / body |
| GMAIL_SEND_DRAFT | 发送已存草稿 | draft_id |
| GMAIL_FETCH_EMAILS | 拉邮件列表/搜索 | query（支持 in:sent、is:unread）/ max_results |
| GMAIL_FETCH_MESSAGE_BY_THREAD_ID | 按线程取完整对话 | thread_id |
| GMAIL_REPLY_TO_THREAD | 在原线程回复 | thread_id / body |
| GMAIL_GET_PROFILE | 验证当前邮箱身份 | 无 |

## Google Sheets（线索入库，需先 connect GOOGLESHEETS）
- GOOGLESHEETS_CREATE_SPREADSHEET（建表）、_ADD_ROWS / _APPEND_VALUES（追加行/线索）
- _FIND_ROW / _GET_VALUES（查重/读取）、_UPDATE_ROW（更新跟进状态）

## CRM（三选一，需先连接）
- HubSpot：HUBSPOT_CREATE_CONTACT、HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA、HUBSPOT_CREATE_DEAL
- Salesforce：SALESFORCE_CREATE_LEAD、SALESFORCE_SEARCH_LEADS、SALESFORCE_UPDATE_LEAD
- Zoho：ZOHO_CREATE_ZOHO_RECORD、ZOHO_SEARCH_ZOHO_RECORDS、ZOHO_CONVERT_ZOHO_LEAD

## 日历（自动约访）
- GOOGLECALENDAR_FIND_FREE_SLOTS（找空档）、_CREATE_EVENT（建会议）、_LIST_EVENTS

## 团队通知 / 其他
- SLACK_SEND_MESSAGE、DISCORD_SEND_MESSAGE（内部通知）
- LINKEDIN 系列（客户资料/动态）、NOTION 系列（知识库）、OUTLOOK 系列（Exchange 邮箱）

## 销售自动化流水线建议
1. 新线索 → GOOGLESHEETS 追加一行（公司/姓名/电话/联系时间/备注，沿用既定客户表字段）
2. 首触达 → GMAIL_CREATE_EMAIL_DRAFT 出草稿，用户确认后 GMAIL_SEND_DRAFT
3. 到点跟进 → 配合定时任务，GMAIL_FETCH_EMAILS 查回复，未回则 GMAIL_REPLY_TO_THREAD 跟进
4. 成交/意向 → HUBSPOT/SALESFORCE 创建 Contact/Lead
