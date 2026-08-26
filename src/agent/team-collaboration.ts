/**
 * 飞虹 Code - 团队协作模块 (P2-3)
 * 在企业级 RBAC 基础上增强：团队成员管理、共享任务、团队配置、协作权限
 *
 * 设计原则：
 * - 团队数据持久化到 ~/.feihong-code/team/ 目录
 * - 成员角色继承企业级 Policy（admin/developer/viewer）
 * - 共享任务支持查看、评论、协作编辑
 * - 所有操作记录审计日志
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveHomeDir } from '../shared/config';
import { logger } from '../shared/logger';

/** 团队成员角色 */
export type TeamRole = 'owner' | 'admin' | 'developer' | 'viewer';

/** 团队成员 */
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  avatar?: string;
  joinedAt: string;
  lastActiveAt: string;
  status: 'active' | 'invited' | 'disabled';
}

/** 共享任务 */
export interface SharedTask {
  id: string;
  title: string;
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  status: 'todo' | 'in-progress' | 'review' | 'done';
  assignees: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  tags: string[];
  comments: Array<{
    id: string;
    author: string;
    content: string;
    createdAt: string;
  }>;
  linkedTaskId?: string;
}

/** 团队配置 */
export interface TeamConfig {
  name: string;
  description: string;
  defaultRole: TeamRole;
  allowedWorkspaces: string[];
  sharedModels: string[];
  maxMembers: number;
  requireApprovalFor: string[];
}

/** 团队数据 */
export interface TeamData {
  id: string;
  config: TeamConfig;
  members: TeamMember[];
  tasks: SharedTask[];
  createdAt: string;
  updatedAt: string;
}

/** 角色权限矩阵 */
const ROLE_PERMISSIONS: Record<TeamRole, string[]> = {
  owner: ['*'],
  admin: [
    'team:manage', 'member:invite', 'member:remove', 'member:role',
    'task:create', 'task:edit', 'task:delete', 'task:assign',
    'task:comment', 'config:edit', 'workspace:access',
  ],
  developer: [
    'task:create', 'task:edit', 'task:assign', 'task:comment',
    'workspace:access',
  ],
  viewer: [
    'task:view', 'task:comment', 'workspace:view',
  ],
};

/**
 * 团队协作管理器
 */
export class TeamCollaborationManager {
  private data: TeamData;
  private dataPath: string;

  constructor(homeDir?: string) {
    const base = homeDir || resolveHomeDir();
    const teamDir = join(base, 'team');
    if (!existsSync(teamDir)) {
      mkdirSync(teamDir, { recursive: true });
    }
    this.dataPath = join(teamDir, 'team.json');
    this.data = this.load();
  }

  /** 加载团队数据 */
  private load(): TeamData {
    if (existsSync(this.dataPath)) {
      try {
        const raw = readFileSync(this.dataPath, 'utf-8');
        return JSON.parse(raw) as TeamData;
      } catch (e) {
        logger.warn('team data load failed, using default', { error: e instanceof Error ? e.message : String(e) });
      }
    }
    // 默认团队
    const defaultData: TeamData = {
      id: 'default-team',
      config: {
        name: '默认团队',
        description: '飞虹 Code 默认协作团队',
        defaultRole: 'developer',
        allowedWorkspaces: [],
        sharedModels: [],
        maxMembers: 10,
        requireApprovalFor: ['write_file', 'run_shell'],
      },
      members: [
        {
          id: 'owner-1',
          name: '团队所有者',
          email: 'owner@feihong.local',
          role: 'owner',
          joinedAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          status: 'active',
        },
      ],
      tasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.save(defaultData);
    return defaultData;
  }

  /** 保存团队数据 */
  private save(data?: TeamData): void {
    const toSave = data || this.data;
    toSave.updatedAt = new Date().toISOString();
    writeFileSync(this.dataPath, JSON.stringify(toSave, null, 2), 'utf-8');
  }

  /** 获取团队数据 */
  getTeam(): TeamData {
    return this.data;
  }

  /** 更新团队配置 */
  updateConfig(config: Partial<TeamConfig>): TeamConfig {
    this.data.config = { ...this.data.config, ...config };
    this.save();
    logger.info('team config updated', { config });
    return this.data.config;
  }

  /** 获取成员列表 */
  getMembers(): TeamMember[] {
    return this.data.members;
  }

  /** 获取单个成员 */
  getMember(id: string): TeamMember | undefined {
    return this.data.members.find((m) => m.id === id);
  }

  /** 邀请成员 */
  inviteMember(name: string, email: string, role: TeamRole = 'developer'): TeamMember {
    if (this.data.members.length >= this.data.config.maxMembers) {
      throw new Error(`团队成员已达上限 ${this.data.config.maxMembers}`);
    }
    if (this.data.members.some((m) => m.email === email)) {
      throw new Error('该邮箱已在团队中');
    }
    const member: TeamMember = {
      id: `member-${Date.now()}`,
      name,
      email,
      role,
      joinedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: 'invited',
    };
    this.data.members.push(member);
    this.save();
    logger.info('member invited', { memberId: member.id, email, role });
    return member;
  }

  /** 更新成员角色 */
  updateMemberRole(id: string, role: TeamRole): TeamMember {
    const member = this.getMember(id);
    if (!member) throw new Error('成员不存在');
    if (member.role === 'owner') throw new Error('不能修改所有者角色');
    member.role = role;
    this.save();
    logger.info('member role updated', { memberId: id, role });
    return member;
  }

  /** 移除成员 */
  removeMember(id: string): void {
    const member = this.getMember(id);
    if (!member) throw new Error('成员不存在');
    if (member.role === 'owner') throw new Error('不能移除所有者');
    this.data.members = this.data.members.filter((m) => m.id !== id);
    this.save();
    logger.info('member removed', { memberId: id });
  }

  /** 检查成员权限 */
  hasPermission(memberId: string, permission: string): boolean {
    const member = this.getMember(memberId);
    if (!member) return false;
    const perms = ROLE_PERMISSIONS[member.role] || [];
    return perms.includes('*') || perms.includes(permission);
  }

  /** 获取共享任务列表 */
  getTasks(status?: SharedTask['status']): SharedTask[] {
    let tasks = this.data.tasks;
    if (status) tasks = tasks.filter((t) => t.status === status);
    return tasks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  /** 获取单个任务 */
  getTask(id: string): SharedTask | undefined {
    return this.data.tasks.find((t) => t.id === id);
  }

  /** 创建共享任务 */
  createTask(
    title: string,
    createdBy: string,
    opts: Partial<SharedTask> = {},
  ): SharedTask {
    const task: SharedTask = {
      id: `task-${Date.now()}`,
      title,
      description: opts.description || '',
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: opts.status || 'todo',
      assignees: opts.assignees || [],
      priority: opts.priority || 'medium',
      tags: opts.tags || [],
      comments: [],
      linkedTaskId: opts.linkedTaskId,
    };
    this.data.tasks.push(task);
    this.save();
    logger.info('shared task created', { taskId: task.id, title, createdBy });
    return task;
  }

  /** 更新任务 */
  updateTask(id: string, updates: Partial<SharedTask>): SharedTask {
    const task = this.getTask(id);
    if (!task) throw new Error('任务不存在');
    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    this.save();
    logger.info('shared task updated', { taskId: id, updates });
    return task;
  }

  /** 删除任务 */
  deleteTask(id: string): void {
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id);
    this.save();
    logger.info('shared task deleted', { taskId: id });
  }

  /** 添加任务评论 */
  addComment(taskId: string, author: string, content: string): SharedTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error('任务不存在');
    task.comments.push({
      id: `comment-${Date.now()}`,
      author,
      content,
      createdAt: new Date().toISOString(),
    });
    task.updatedAt = new Date().toISOString();
    this.save();
    return task;
  }

  /** 获取团队统计 */
  getStats(): {
    totalMembers: number;
    activeMembers: number;
    totalTasks: number;
    todoTasks: number;
    inProgressTasks: number;
    reviewTasks: number;
    doneTasks: number;
  } {
    const members = this.data.members;
    const tasks = this.data.tasks;
    return {
      totalMembers: members.length,
      activeMembers: members.filter((m) => m.status === 'active').length,
      totalTasks: tasks.length,
      todoTasks: tasks.filter((t) => t.status === 'todo').length,
      inProgressTasks: tasks.filter((t) => t.status === 'in-progress').length,
      reviewTasks: tasks.filter((t) => t.status === 'review').length,
      doneTasks: tasks.filter((t) => t.status === 'done').length,
    };
  }
}

/** 便捷函数：创建团队协作管理器 */
export function createTeamCollaborationManager(homeDir?: string): TeamCollaborationManager {
  return new TeamCollaborationManager(homeDir);
}
