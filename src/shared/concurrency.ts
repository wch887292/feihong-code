/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 并发控制工具：限制异步任务的最大并发数，防止 API 限流和资源耗尽。
 */

/**
 * 异步任务池：限制最大并发数。
 * 类似 p-limit，但零依赖，适用于需要控制模型调用、文件IO等并发场景。
 *
 * @example
 * const limit = asyncPool(3);
 * const results = await Promise.all(tasks.map(t => limit(() => fetch(t))));
 */
export function asyncPool(concurrency: number) {
  const max = Math.max(1, concurrency);
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active < max && queue.length > 0) {
      const resolve = queue.shift()!;
      active++;
      resolve();
    }
  };

  const acquire = (): Promise<void> => {
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => queue.push(resolve));
  };

  const release = () => {
    active--;
    next();
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    acquire().then(() =>
      fn().then(
        (result) => {
          release();
          return result;
        },
        (error) => {
          release();
          throw error;
        },
      ),
    );
}

/**
 * 批量执行异步任务，限制最大并发数。
 * 自动保留原始顺序，所有任务完成后返回结果数组。
 *
 * @param tasks 任务工厂函数数组
 * @param concurrency 最大并发数（默认 3）
 * @returns 按原始顺序排列的结果数组
 *
 * @example
 * const results = await runWithConcurrency(
 *   urls.map(url => () => fetch(url)),
 *   3
 * );
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number = 3,
): Promise<T[]> {
  const limit = asyncPool(concurrency);
  return Promise.all(tasks.map((task) => limit(task)));
}

/**
 * 批量执行异步任务，限制最大并发数，允许部分失败。
 * 类似 Promise.allSettled，但有并发限制。
 *
 * @param tasks 任务工厂函数数组
 * @param concurrency 最大并发数（默认 3）
 * @returns PromiseSettledResult 数组
 */
export async function runWithConcurrencySettled<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number = 3,
): Promise<Array<PromiseSettledResult<T>>> {
  const limit = asyncPool(concurrency);
  return Promise.allSettled(tasks.map((task) => limit(task)));
}
