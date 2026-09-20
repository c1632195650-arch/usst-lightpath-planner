/**
 * 课表解析服务客户端 —— 对接 timetable_parser/server.py（默认 http://127.0.0.1:8765）
 *
 * 默认走 **同源代理** `/timetable`（在 vite.config.ts 里转发到 8765）：
 * dev 与 preview 都配了，浏览器看到的是同源请求，天然没有 CORS 和 OPTIONS 预检问题，
 * Python 端不用加任何跨域头。
 *
 * 想直连就把 VITE_TIMETABLE_BASE 设成 http://127.0.0.1:8765 —— 但那样是真跨域，
 * 必须先给 server.py 加 Access-Control-Allow-Origin 和 do_OPTIONS，否则浏览器会拦。
 *
 * 注意：这里允许 fetch（它不在 src/lib/planner/** 下，不违反排程引擎的纯函数约束）。
 */

import {
  recordsToSchedule,
  semesterKeyFromFileName,
  validateSchedule,
  type AdaptResult,
  type CourseRecord,
  type ScheduleIssue,
  type ScheduleMeta,
} from './parseSchedule';

const BASE = (import.meta.env.VITE_TIMETABLE_BASE as string | undefined) ?? '/timetable';

export type ImportResult =
  | { ok: true; count: number; records: CourseRecord[] }
  | { ok: false; error: string };

/** 拉取当前已解析的总课表（服务端持久化的 course_records.json） */
export async function fetchCourseRecords(): Promise<CourseRecord[]> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/courses`);
  } catch {
    throw new Error('连不上课表解析服务（127.0.0.1:8765）。请先启动：python server.py 8765');
  }
  if (!res.ok) throw new Error(`课表服务 /courses 返回 HTTP ${res.status}`);
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as CourseRecord[]) : [];
}

/**
 * 上传 PDF 课表并解析。
 * 服务端按 Content-Length 读原始字节，不看 Content-Type，请求体直接放 ArrayBuffer。
 * 失败时服务端仍然返回 200，但 ok=false 并带中文 error —— 业务失败不当 HTTP 错误抛。
 */
export async function importPdf(file: Blob): Promise<ImportResult> {
  const body = await file.arrayBuffer();
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/import_pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body,
    });
  } catch {
    throw new Error('连不上课表解析服务（127.0.0.1:8765）。请先启动：python server.py 8765');
  }
  if (!res.ok) throw new Error(`课表服务 /api/import_pdf 返回 HTTP ${res.status}`);
  return (await res.json()) as ImportResult;
}

/** 探活：服务在不在（用于 UI 显示"解析器未启动"提示） */
export async function pingTimetableService(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/courses`);
    return res.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 下面两个是给 UI 的「一次调用」入口：拉数据 → 适配 → 自检，一步到位。
 * termStart 不用调用方管：传个学期 key 或带学期的文件名（教务默认名
 * 「姓名(2026-2027-1)课表.pdf」就带），校历常量会自动解出来。
 * ------------------------------------------------------------------ */

export interface ImportOptions extends ScheduleMeta {
  /** PDF 文件名，用于抠学期 key。传了就不用另给 semesterKey */
  fileName?: string;
}

export interface ScheduleImportResult extends AdaptResult {
  /** validateSchedule 的结果，UI 直接渲染即可 */
  issues: ScheduleIssue[];
}

function fileNameOf(blob: Blob, fallback?: string): string {
  if (fallback) return fallback;
  return 'name' in blob && typeof (blob as File).name === 'string' ? (blob as File).name : '';
}

/** 上传 PDF → 直接得到校验过的 Schedule */
export async function importPdfToSchedule(
  file: Blob,
  options: ImportOptions = {},
): Promise<ScheduleImportResult> {
  const { fileName, ...meta } = options;
  const res = await importPdf(file);
  if (!res.ok) throw new Error(res.error);
  return build(res.records, meta, fileNameOf(file, fileName));
}

/** 拉取服务已持久化的课表（刷新/重进页面时用）→ Schedule */
export async function fetchSchedule(options: ImportOptions = {}): Promise<ScheduleImportResult> {
  return build(await fetchCourseRecords(), options, options.fileName ?? '');
}

function build(records: CourseRecord[], meta: ScheduleMeta, fileName: string): ScheduleImportResult {
  const out = recordsToSchedule(records, {
    ...meta,
    semesterKey: meta.semesterKey ?? semesterKeyFromFileName(fileName),
  });
  return { ...out, issues: validateSchedule(out.schedule, out.term) };
}
