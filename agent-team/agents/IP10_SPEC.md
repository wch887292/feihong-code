# IP 服务层 10 名数字技能员工 · 规格与协同矩阵（22-31）

晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹

## 一、来源题材

《吴赐虹·三位一体利他服务人设生态体系（完整版）》。

三大维度：
- 第一维 企业经营利他赋能：合伙人制度落地 + AI 全链路降本增效
- 第二维 家业财富安全赋能：健康 / 现金流 / 家企隔离 / 传承
- 第三维 终身陪跑服务生态：诊断 → 优化 → 兜底

四步标准服务链路：免费诊断 → 按需匹配 → 落地陪跑 → 终身服务

## 二、员工清单与契约（module_id 22-31）

统一实现范式（对齐 agents/l0_command.py 的 18/19/20）：
- 模块级纯函数 `run_logic_NN(data, llm=None)`，不依赖实例与数据库
- `llm_json(llm, prompt=..., system=..., schema_hint=..., fallback=..., max_tokens=4000)` 生成主体产出
- 规则模板 `fallback` 兜底（LLM 不可用时原样返回）
- 输出必须含 `handoff_to` 交接对象字段，实现协同作战
- 每个 BaseAgent 子类声明：module_id / name / layer / priority / description / input_schema / output_keys / run_logic

**契约硬约束（check_agents.py 会校验）**：
1. input_schema 声明的每个字段，必须在 run_logic 中以 `data.get("字段名")` 读取；
2. run_logic 中 `data.get(...)` 读取的每个 key，必须在 input_schema 中声明（白名单除外）；
3. `llm_json(` 与 `from llm.llm_json import` 必须同时存在；
4. 全部 .py 编译通过；f-string 内不得出现英文双引号嵌套（用「」）。

### 第一维：企业经营利他赋能

**22 企业实况诊断官**（layer=L6, priority=P0）——「免费诊断」入口
- input_schema: `{"company_profile": "企业基本画像（行业/规模/团队/现有机制）", "symptoms": "老板自述的经营症状与诉求"}`
- output_keys: `{"diagnosis": "经营体检报告", "handoff_to": "交接对象"}`
- 职责：只诊断不推销。按「爱与利他 / 事的目的 / 人的利益点」三层出体检报告，识别利润结构、团队稳定、机制缺失、AI 成熟度四类问题，给出可验证指标与优先级。
- handoff_to: `28 服务匹配官`

**23 合伙机制架构师**（L6, P0）
- input_schema: `{"diagnosis": "上游经营体检报告", "org_structure": "现有股权/组织/岗位与贡献现状"}`
- output_keys: `{"mechanism": "合伙机制设计方案", "handoff_to": "交接对象"}`
- 职责：设计利润分红模型。产出股权/分红/留存发展基金三段比例、贡献积分权重、进入与退出规则、约束红线。
- handoff_to: `24 组织落地教练`

**24 组织落地教练**（L6, P0）
- input_schema: `{"mechanism": "上游合伙机制方案", "team_info": "团队现状与关键角色"}`
- output_keys: `{"execution": "落地陪跑计划", "handoff_to": "交接对象"}`
- 职责：机制不落地等于零。产出宣导节奏、岗位责任书、沟通与例会机制、考核与激励落地清单、90 天陪跑里程碑。
- handoff_to: `29 终身陪跑管家`

**30 AI 降本增效架构师**（L6, P1）
- input_schema: `{"diagnosis": "上游经营体检报告", "workflow_现状": "当前业务流程与人力投入现状"}`
- output_keys: `{"ai_plan": "AI 全链路降本增效方案", "handoff_to": "交接对象"}`
- 职责：把 AI 落到具体流程。产出环节级 AI 替代/增强清单、可复用数字员工编排建议、投入产出测算、上线顺序与风险兜底。
- handoff_to: `24 组织落地教练`

### 第二维：家业财富安全赋能

**25 家业风险隔离顾问**（L6, P0）
- input_schema: `{"diagnosis": "上游经营体检报告", "family_assets": "家庭资产与企业资产现状"}`
- output_keys: `{"isolation_plan": "家业风险隔离方案", "handoff_to": "交接对象"}`
- 职责：家企隔离。产出三层防火墙（家庭/企业/个人）、股权与债务隔离结构、常见风险点与整改优先级、合规红线。
- handoff_to: `26 健康财富规划师`

**26 健康财富规划师**（L6, P0）
- input_schema: `{"isolation_plan": "上游家业隔离方案", "health_finance_need": "健康状况与现金流保障诉求"}`
- output_keys: `{"protection_plan": "健康财富保障方案", "handoff_to": "交接对象"}`
- 职责：只做规划不直接推产品。产出健康与保障缺口诊断、现金流安全垫测算、保障层级建议、不推销声明与转介边界。
- handoff_to: `27 财富传承顾问`

**27 财富传承顾问**（L6, P1）
- input_schema: `{"protection_plan": "上游健康财富保障方案", "family_heir_info": "子女/接班人与家业现状"}`
- output_keys: `{"inheritance_plan": "家业传承方案", "handoff_to": "交接对象"}`
- 职责：家业不散。产出传承结构建议、接班人与股权安排、家风与家训、传承风险点与阶段性动作。
- handoff_to: `29 终身陪跑管家`

### 第三维：终身陪跑与按需匹配

**28 服务匹配官**（L6, P0）——「按需匹配」环节
- input_schema: `{"diagnosis": "上游经营体检报告", "service_preference": "客户偏好的服务方式/预算/节奏"}`
- output_keys: `{"match_result": "服务匹配方案", "handoff_to": "交接对象"}`
- 职责：不推销只匹配。按体检结论决定走哪条服务线（经营机制 / AI 降本 / 家业财富 / 陪跑），给出「先做什么、暂不做什么、为什么」的排序与理由。
- handoff_to: `23 合伙机制架构师`（按需也可能转 30 / 25）

**29 终身陪跑管家**（L6, P0）——「落地陪跑 + 终身服务」环节
- input_schema: `{"execution": "上游落地陪跑计划", "client_profile": "客户档案与已落地内容"}`
- output_keys: `{"escort_plan": "终身陪跑与兜底计划", "handoff_to": "交接对象"}`
- 职责：终身。产出年度体检节奏、关键节点提醒、效果度量指标、异常兜底与转介机制、下一年重点议题。
- handoff_to: `31 案例见证官`

**31 案例见证官**（L6, P1）
- input_schema: `{"escort_plan": "上游陪跑计划", "result_data": "落地结果与关键数据"}`
- output_keys: `{"case_study": "客户见证案例", "handoff_to": "交接对象"}`
- 职责：把成果变成信任背书。产出可对外使用的中性案例（脱敏）、前后对比数据、客户原话引用要点、授权与合规注意事项。
- handoff_to: `22 企业实况诊断官`（回流复诊，形成闭环）

## 三、协同作战链路

主链路（免费诊断 → 按需匹配 → 落地陪跑 → 终身服务）：
```
22 企业实况诊断官
  └─→ 28 服务匹配官
        ├─→ 23 合伙机制架构师 ──→ 24 组织落地教练 ──┐
        ├─→ 30 AI 降本增效架构师 ────────────────────┤
        └─→ 25 家业风险隔离顾问 → 26 健康财富规划师 → 27 财富传承顾问 ─┤
                                                                      ↓
                                                            29 终身陪跑管家
                                                                      ↓
                                                            31 案例见证官
                                                                      ↓
                                                        （回流）22 企业实况诊断官
```

分支说明：
- 24 组织落地教练同时接收 23 与 30 的产出（机制落地 + AI 落地合并陪跑）
- 29 终身陪跑管家同时接收 24 与 27 的产出（经营陪跑 + 财富陪跑合并为终身计划）
- 31 案例见证官产出回流 22，形成年度复诊闭环

## 四、落地要求

1. 新建文件 `agents/l6_ip_service.py`，承载 22-31 十个员工实现（沿用 agents/l0_command.py 的文件组织风格与文件头署名三行）。
2. 在 `agents/registry.py` 的 AGENT_CLASSES 中追加 22-31 十个类，并把 docstring「17 个」改为「31 个」。
3. `python check_agents.py` 全绿。
4. 同步更新 `main.py` 中的「17 个」文案为「31 个」。
5. 不改动既有 01-21 员工的任何行为。

## 五、交付验收

- `python check_agents.py` → ✅ 全部检查通过
- `python main.py list-agents` → 31 个员工可见
- 无 mock LLM 时（LLM_PROVIDER=mock）每个新员工 run_logic 仍能返回含 handoff_to 的字典
