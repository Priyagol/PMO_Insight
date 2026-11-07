# Arihant Workspace - Product Requirements Document

> Source: architecture review approved on 2026-11-06. Update this document as the implementation evolves.

## 1. Product understanding

Arihant Workspace is the single system of record for _work_: what is planned (projects, milestones, tasks), who does it (assignment, capacity), what was done (work logs, timesheets, journals), what blocks it (risks, issues, dependencies), what was decided (meetings and minutes) and how the organisation is doing (analytics). Its main differentiator is the **Smart Assignment Engine**, which distributes work automatically using workload, capacity, skills and availability, followed by **management intelligence** (health scores, early warnings, Ask Your Data). Users are internal employees across 8 internal roles plus restricted external stakeholders.

## 2. Refined PRD (summary)

| Goal                                       | Success measure                                         |
| ------------------------------------------ | ------------------------------------------------------- |
| One source of truth for projects and tasks | 100% of active projects tracked in-app                  |
| Remove manual ticket distribution          | ≥80% of QA/dev tickets auto- or suggest-assigned        |
| Full time visibility                       | ≥95% weekly timesheet submission                        |
| Early delay detection                      | At-risk flag raised ≥5 working days before the deadline |
| Management self-service reporting          | Snapshot/report generated in <10 s                      |

Personas: Director (org view, reports), Department Head (department view), PM (projects, approvals, assignment), Team Lead (team board, rebalancing), Developer/Tester/Employee (my work, logs, timer), Super Admin (config), External Stakeholder (shared project view, feedback, sign-off).

## 15. MVP scope

| Tier                                  | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MVP (Phases 1–4 + dashboard core)** | Foundation, auth (JWT + rotation), users/departments/roles/permissions, employee directory, availability/leave, projects (CRUD, members, 360° overview, archive, duplicate), tasks (full fields, subtasks, checklist, comments, @mentions, attachments, watchers, bulk ops, activity), Kanban/List/Calendar views, saved filters, work logs + timer + weekly timesheets + approvals + daily journal, **Smart Assignment (suggest/batch preview/approve/history/rebalance/reassign)**, in-app + email notifications with Socket.IO, executive dashboard + my workspace, audit log, CSV export |
| **Advanced (Phases 5–6)**             | Timeline/Gantt, milestones, sprints, epics, dependencies, project health + early warnings, full analytics suite + snapshot PDF/Excel, risks/issues + heatmap, meetings/MOM → tasks, documents + versions + approval, configurable multi-level approval engine, releases/deployments, stakeholders + change requests, templates, project versions, recurring tasks, custom fields                                                                                                                                                                                                             |
| **Phase 7**                           | AI assistant, Ask Your Data, Automation Center, Workflow Builder, predictive risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Future**                            | SSO (Entra/Google OIDC), external stakeholder portal hardening + MFA, HRMS leave sync, Git/CI integration for build status, mobile app, multi-tenant SaaS mode                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Missing business decisions (assumptions made, adjustable later)

1. Work week Mon–Fri, 8 h/day, 40 h/week capacity default; org holiday calendar maintained by admin.
2. Leave records are entered and approved in-app (no HRMS integration yet).
3. Timesheets are weekly; submission is due Monday 11:00 IST for the previous week.
4. Closure approval is off by default and enabled per project.
5. Budget is in INR only; there is no cost-rate or billing module.
6. Employees see colleagues' names and assigned tasks within shared projects, but **not** others' work logs, utilisation or Work Passport (manager chain only).
7. Retention: audit logs 7 years, notifications 180 days, automation runs 90 days.
8. Expected scale: about 50–1,000 users, single organisation (no multi-tenancy).
9. Email goes through the company SMTP relay; Mailpit is used in development.
10. AI features send only the minimum project text needed to the Claude API; an admin can disable AI globally (in case outbound data policy forbids it).
