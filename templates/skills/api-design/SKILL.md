---
name: "REST API 设计评审"
description: "对 API 设计进行评审：资源建模、状态码、校验、版本化、安全、文档。"
---

# REST API 设计评审

<!-- 模板占位：使用 `fhcode skill-new <name> --template api-design` 复制并定制 -->

## 触发
当用户设计/评审 REST API、接口文档、OpenAPI 规范时使用。

## 执行步骤
1. 评审资源建模：RESTful 资源 + 动作语义（GET 幂等、POST 创建、PUT 全量、PATCH 部分）
2. 状态码：200/201/400/401/403/404/409/422/500 使用是否准确
3. 输入校验：必填/类型/边界/枚举；错误响应格式统一
4. 版本化：/v1/ 前缀或 header；兼容性策略
5. 安全：认证/授权、限流、敏感字段脱敏、防注入
6. 文档：OpenAPI 完整性（schema/示例/错误码）

## 输出格式
逐项评审结论 + 修改建议（含示例 JSON 响应）。
