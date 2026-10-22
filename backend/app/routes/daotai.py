"""导演台 H3 (det16) 生视频能力 — nsfwxo 后端独立运行

把 8765 开放 API 的 det16 生视频能力（工作流 2110330160000516098，自杀式免扣分）
迁移到本后端：直接 import rh_h3_web 核心模块复用 Job/run_job/轮询/合并逻辑，
提供 /api/daotai/video、/api/daotai/query 与视频静态服务。
8765 端口停用也能独立生成、获取视频。
"""
import os
import sys
import json
import re
import threading
import urllib.parse
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, FileResponse

# ── rh_h3_web 核心模块：已迁移到本项目后端（backend/app/services/daotai_runtime/）────
# 不再依赖外部 8765 项目的 rh_h3_web 目录。整个生图/生视频运行时（rh 模块、状态、产物落盘）
# 都在 nsfwxo 后端内自洽，8765 端口可以安全停掉。
#
# 1. import 路径：app.services.daotai_runtime.rh_h3_web
# 2. 产物落盘：rh.WEB_ROOT 自动指向 backend/app/services/daotai_runtime/，避免外部路径耦合
# 3. 静态服务：/api/daotai/image/media/* 和 /api/daotai/media/* 都从 rh.WEB_ROOT 提供
NSFWXO_DAOTAI_RUNTIME = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'app', 'services', 'daotai_runtime',
)
if NSFWXO_DAOTAI_RUNTIME not in sys.path:
    sys.path.insert(0, NSFWXO_DAOTAI_RUNTIME)

import rh_h3_web as rh  # noqa: E402

router = APIRouter(prefix='/api/daotai', tags=['daotai'])

# 仅接受纯文件名（防路径穿越）
_SAFE = re.compile(r'^[\w\-. ()%]+$')


def _video_refs(body: dict):
    """复刻 8765 openapi 视频分支的参考图收集：显式 firstFrameUrl 为 ref[0]，再收 media。

    上限 = 目标工作流 ref_nodes 数（det16 = 5），按 URL 去重；返回本地下载路径列表。
    """
    _wfc = rh.VIDEO_WFS.get(str(body.get('workflow_id') or rh.RH_VIDEO_WFID), {})
    _cap = len(_wfc.get('ref_nodes') or rh.REF_NODES)
    refs = []
    seen = set()
    _main = body.get('firstFrameUrl') or body.get('first_frame') or body.get('imageUrl')
    if _main:
        seen.add(str(_main))
        rf = rh._rh_dl_ref(str(_main))
        if rf:
            refs.append(rf)
    if isinstance(body.get('media'), list):
        for m in body['media']:
            if len(refs) >= _cap:
                break
            if not isinstance(m, dict):
                continue
            mu = str(m.get('url') or '')
            if not (mu and m.get('type') in ('first_frame', 'reference_image')):
                continue
            if mu in seen:
                continue
            seen.add(mu)
            rf = rh._rh_dl_ref(mu)
            if rf and rf not in refs:
                refs.append(rf)
    if not refs:
        refs = ['']
    return refs


def _clip_shots(prompt: str, shots_per_seg: int):
    """复刻 8765 的提示词裁剪：保留前 shots_per_seg 个 [Shot N]。"""
    _shot_idxs = [m.start() for m in re.finditer(r'(?m)^\s*\[Shot\s+\d+\]', prompt)]
    if not _shot_idxs:
        _shot_idxs = [m.start() for m in re.finditer(r'\[Shot\s+\d+\]', prompt)]
    if _shot_idxs:
        _head = prompt[:_shot_idxs[0]].rstrip()
        if shots_per_seg >= len(_shot_idxs):
            _rest = prompt[_shot_idxs[0]:]
        else:
            _rest = prompt[_shot_idxs[0]:_shot_idxs[shots_per_seg]].rstrip()
        return (_head + '\n' if _head else '') + _rest
    return '[Shot 1] ' + prompt.strip()


# 分镜标记归一化：画布切分链（TextFindAndReplace）锚点只认 [Shot N]，
# 用户脚本可能是 [分镜 N]/[镜头 N]/行首 分镜N/镜头N/Shot N → 统一替换为 [Shot N]，
# 否则 _clip_shots 不裁剪（整段注入 500）+ 1305/1306/1351/1304 提取失败输出原样 500
# → 1307 合并 ≈ 19634 tokens → 15 LLM 节点 n_ctx 16384 爆窗任务失败。
_SHOT_NORM = [
    (re.compile(r'\[\s*分镜\s*(\d+)\s*\]'), r'[Shot \1]'),
    (re.compile(r'\[\s*镜头\s*(\d+)\s*\]'), r'[Shot \1]'),
    (re.compile(r'\[\s*Shot\s*(\d+)\s*\]', re.I), r'[Shot \1]'),
    (re.compile(r'(?m)^\s*(?:分镜|镜头)\s*(\d+)\b'), r'[Shot \1]'),
    (re.compile(r'(?m)^\s*Shot\s*(\d+)\b', re.I), r'[Shot \1]'),
]


def _normalize_shot_marks(prompt: str) -> str:
    """统一分镜标记为 [Shot N]（画布切分链锚点），供 det16/global 提交使用。"""
    if not prompt:
        return prompt
    for pat, repl in _SHOT_NORM:
        prompt = pat.sub(repl, prompt)
    return prompt


@router.post('/video')
async def submit_video(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={'error': 'bad json'})
    key = ''
    auth = request.headers.get('Authorization', '')
    if auth.lower().startswith('bearer '):
        key = auth[7:].strip()
    # ===== 服务端默认 Key 兜底（推荐用环境变量配，避免前端没传/写错时任务直接挂）=====
    # 优先级：前端 Bearer > DAOTAI_API_KEY > RUNNINGHUB_API_KEY
    if not key:
        key = (os.environ.get('DAOTAI_API_KEY')
               or os.environ.get('RUNNINGHUB_API_KEY')
               or '').strip()
    if not key:
        return JSONResponse(status_code=400, content={'error': '缺少 Authorization: Bearer <apiKey>（或服务端未配置 DAOTAI_API_KEY 环境变量）'})

    prompt = body.get('prompt') or ''
    if not prompt.strip():
        return JSONResponse(status_code=400, content={'error': 'prompt 不能为空'})

    _wfid = str(body.get('workflow_id') or rh.RH_VIDEO_WFID)
    if not body.get('workflow_id') and rh.MODEL_LOCK.get('video'):
        _wfid = rh.MODEL_LOCK['video']

    refs = _video_refs(body)
    # 2026-10-22 防"参考图静默丢失"：请求里带了参考图但一张都没落地时直接报错。
    # 否则工作流 LoadImage 28/273/285 会沿用画布上一次保存的旧图 →
    # 生成出来的不是用户选的人（首段尤其明显：等于把旧参考图做成贴图动画）。
    _want_refs = bool(
        body.get('firstFrameUrl') or body.get('first_frame') or body.get('imageUrl')
        or (isinstance(body.get('media'), list)
            and any(isinstance(m, dict) and m.get('url') for m in body['media']))
    )
    if _want_refs and not any(refs):
        return JSONResponse(status_code=400, content={
            'error': '参考图下载失败（平台 CDN 连接被断开 / 下载 URL 失效）——已中止提交，'
                     '避免工作流沿用画布旧参考图生成错误人物。请重新上传参考图后重试。',
            'kind': 'ref_download_failed',
        })
    shots_per_seg = max(1, int(body.get('shots_per_seg') or 1))
    # 分镜标记归一化（[分镜 N]/[镜头 N]/行首 Shot N → [Shot N]），保证画布切分链锚点命中
    prompt = _normalize_shot_marks(prompt)
    # det16 工作流：500 需要完整全局提示词（画布按 503 目标段数确定性切分，forLoop 合并），
    # shots_per_seg 对 det16 无意义，裁剪会丢剧情 → 仅非 det16 走裁剪
    if rh.VIDEO_WFS.get(_wfid, {}).get('mode') != 'det16':
        prompt = _clip_shots(prompt, shots_per_seg)

    # 参数锁定：开启时跟随导演台参数
    _pl = rh.PARAM_LOCK.get('video') or {}
    if _pl.get('locked'):
        _res = float(_pl.get('resolution') or 0.4)
        _ar = str(_pl.get('aspect_ratio') or 'match')
    else:
        _res = float(body.get('resolution') or body.get('clarity') or 0.2)
        _ar = str(body.get('aspect_ratio') or 'match')

    cfg = {
        'workflow_id': _wfid, 'api_key': key,
        'mode': 'global', 'global_prompt': prompt,
        'shots_per_seg': shots_per_seg,
        'duration': int(body.get('duration') or 15),
        'resolution': _res,
        'instance': body.get('instance') or 'plus',
        'aspect_ratio': _ar,
        'refs': refs, 'submit_gap': 0.5, 'llm': False,
        'target_segs': int(body['target_segs']) if str(body.get('target_segs') or '').isdigit() else None,
        # 并发路数：det16 多路并行（设置多少就多少）
        'loop_routes': max(1, int(body.get('loop_routes') or 1)),
    }
    try:
        job = rh.Job(cfg)
    except Exception as e:
        _err = f'Job 创建失败: {e}'
        if 'workflow not exists' in _err or 'workflow不存在' in _err:
            return JSONResponse(status_code=502, content={'error': _err, 'kind': 'platform_workflow_missing'})
        if 'API Key' in _err and ('无效' in _err or '失效' in _err):
            return JSONResponse(status_code=401, content={'error': _err, 'kind': 'platform_auth_invalid'})
        if '频率' in _err or 'rate' in _err.lower() or 'too many' in _err.lower():
            return JSONResponse(status_code=429, content={'error': _err, 'kind': 'platform_rate_limit'})
        return JSONResponse(status_code=500, content={'error': _err, 'kind': 'backend_error'})
    with rh.JOBS_LOCK:
        rh.JOBS[job.id] = job
    job.thread = __import__('threading').Thread(target=rh.run_job, args=(job,), daemon=True)
    job.thread.start()
    rh.RH_OPENAPI[job.id] = {'kind': 'video', 'job_id': job.id, 'api_key': key,
                             'run_dir': job.run_dir}
    rh._save_state()   # 持久化 video taskId → run_dir 映射：容器重启后 query 仍能从磁盘恢复视频
    rh._emit(f'[daotai] 视频已提交 {job.id}（model=minimaxh3，refs={len([r for r in refs if r])}，'
             f'shots_per_seg={shots_per_seg}，loop_routes={cfg["loop_routes"]}）')
    return {'taskId': job.id, 'task_id': job.id}


def _query_scan_run_dir(request: Request, tid: str, run_dir: str):
    """容器重启兜底：内存 Job 丢失时，扫描 run_dir 把已落盘的最终视频（>1MB）返回。

    优先按文件名顺序找：
      1) 最终视频.mp4     （多段合并后的产物）
      2) route_*.mp4      （det16 多路结果）
      3) seg_*.mp4        （分段结果；多段时只取最大的，即合并后的产物）
      4) 任意 *.mp4       （兜底）

    文件小于 1MB 视为下载中/截断，跳过。"""
    try:
        cands = []
        for _fn in os.listdir(run_dir):
            if not _fn.endswith('.mp4'):
                continue
            _fp = os.path.join(run_dir, _fn)
            try:
                _sz = os.path.getsize(_fp)
            except OSError:
                continue
            if _sz < 1 * 1024 * 1024:   # < 1MB 视为截断
                continue
            # 优先级排序：最终视频(0) > route_N(1) > seg_N(2) > 其他(3)
            if _fn == '最终视频.mp4':
                _prio = 0
            elif _fn.startswith('route_'):
                _prio = 1
            elif _fn.startswith('seg_'):
                _prio = 2
            else:
                _prio = 3
            cands.append((_prio, _sz, _fn))
        if not cands:
            return {'status': 'PROCESSING', 'taskId': tid,
                    'message': '容器重启后无内存 Job，run_dir 暂无视频（>1MB）—— 等待平台重提交或工作流未完成'}
        cands.sort()   # 优先级 + 同优先级取大
        _fn = cands[0][2]
        _dir = os.path.basename(run_dir)
        u = _absolute_url(request, f'/api/daotai/media/{_dir}/{urllib.parse.quote(_fn)}')
        return {'status': 'SUCCESS', 'video_url': u, 'output': {'video_url': u}, 'url': u,
                'restored': True,
                'message': '容器重启后从 run_dir 恢复（>1MB 视为有效产物）'}
    except Exception as e:
        return {'status': 'FAILED', 'message': '扫描 run_dir 失败: %s' % e}


@router.post('/query')
async def query_task(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={'error': 'bad json'})
    tid = str(body.get('taskId') or body.get('task_id') or '')
    ent = rh.RH_OPENAPI.get(tid)
    if not ent:
        return {'status': 'FAILED', 'message': 'unknown taskId: ' + tid}
    if ent['kind'] == 'image':
        try:
            st, urls, local, th, logs = rh.img_poll(tid, ent.get('api_key') or '')
        except Exception:
            st = 'running'
        if st == 'finished':
            images = [_absolute_url(request, _img_media_url(u)) for u in (local or [])]
            thumbs = [_absolute_url(request, _img_media_url(u)) for u in (th or [])]
            return {'status': 'SUCCESS', 'images': images, 'thumbs': thumbs,
                    'output': {'images': images, 'thumbs': thumbs}}
        if st == 'failed':
            return {'status': 'FAILED', 'message': '图片任务失败: ' + str(tid)}
        return {'status': 'PROCESSING', 'taskId': tid}
    job = rh.JOBS.get(ent['job_id'])
    if not job:
        # ===== 容器重启兜底：内存 JOBS 没了，但 run_dir 还在 → 扫描目录找视频 =====
        # 触发场景：commit 部署 → Railway 重启容器 → RH_OPENAPI 内存清零；
        # 但 _save_state 持久化的 run_dir 让我们能从磁盘恢复。
        _run_dir = ent.get('run_dir') if isinstance(ent, dict) else None
        if _run_dir and os.path.isdir(_run_dir):
            return _query_scan_run_dir(request, tid, _run_dir)
        return {'status': 'FAILED', 'message': 'job lost（容器已重启且 run_dir 也不在了）'}
    snap = rh.job_snapshot(job)
    stt = snap.get('status')
    if stt == 'finished' and snap.get('final_url'):
        _dir = os.path.basename(job.run_dir) if job.run_dir else ''
        _fname = os.path.basename(snap['final_url'])
        u = _absolute_url(request, f'/api/daotai/media/{_dir}/{urllib.parse.quote(_fname)}')
        return {'status': 'SUCCESS', 'video_url': u, 'output': {'video_url': u}, 'url': u}
    if stt == 'finished' and not snap.get('final_url'):
        # 兼容历史错误：status 应该是 failed 而非 finished；这里再做一次兜底
        return {'status': 'FAILED', 'message': '视频合成失败：最终视频未生成（段视频已落盘，可走 bind-local-video 兜底）'}
    if stt in ('failed', 'stopped'):
        # 提取最后一条错误/警告行作为真实原因（job.logs 包含 _emit 的所有行）
        # 优先级：⚠/❌/任务异常/任务提交失败 > 最后一行非空日志
        _logs = list(job.logs or [])
        _reason = ''
        for _line in reversed(_logs):
            if not _line:
                continue
            if any(_line.startswith(p) for p in ('⚠', '❌', '任务异常', '提交失败', '平台拉取失败', '没有任何路', '单路视频缺失', '段视频已生成')):
                _reason = _line
                break
        if not _reason and _logs:
            _reason = _logs[-1]
        _msg = '视频任务失败: ' + str(stt)
        if _reason:
            _msg = '%s | 原因: %s' % (_msg, _reason[:300])
        # ===== 段视频兜底：扫描 run_dir 把 seg_*.mp4 / route_*.mp4 列出来 =====
        # 合成失败时任务标 failed，但段视频已落盘在容器里 —— 前端能直接放 / 下载
        # 不再做"二阶段"提示，直接把 URL 列表塞进响应里
        _segs = []
        try:
            _run_dir = job.run_dir
            _dir = os.path.basename(_run_dir) if _run_dir else ''
            if _dir and rh.VIDEOS_DIR and os.path.isdir(os.path.join(rh.VIDEOS_DIR, _dir)):
                for _fn in sorted(os.listdir(os.path.join(rh.VIDEOS_DIR, _dir))):
                    if _fn.endswith('.mp4') and (_fn.startswith('seg_') or _fn.startswith('route_')):
                        _segs.append({
                            'name': _fn,
                            'url': _absolute_url(request, f'/api/daotai/media/{_dir}/{urllib.parse.quote(_fn)}'),
                            'size': os.path.getsize(os.path.join(rh.VIDEOS_DIR, _dir, _fn)),
                        })
        except Exception:
            pass
        _resp = {'status': 'FAILED', 'message': _msg, 'reason': _reason[:500] if _reason else ''}
        if _segs:
            _resp['segments'] = _segs
            _resp['message'] = '%s | 兜底：已返回 %d 段分段视频（多段合成失败时仍可单独播放/下载）' % (_msg, len(_segs))
        return _resp
    return {'status': 'PROCESSING', 'taskId': tid}


@router.post('/video/logs')
async def video_logs(request: Request):
    """返回视频任务完整日志（排查用：失败时第一时间看真正原因，不靠前端 alert）。
    body: {taskId: '...'}"""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={'error': 'bad json'})
    tid = str(body.get('taskId') or body.get('task_id') or '')
    ent = rh.RH_OPENAPI.get(tid)
    if not ent or ent.get('kind') != 'video':
        return JSONResponse(status_code=404, content={'error': 'unknown taskId: ' + tid})
    job = rh.JOBS.get(ent['job_id'])
    if not job:
        return JSONResponse(status_code=404, content={'error': 'job 已丢失（8765 重启后）'})
    # 返回最后 200 条日志（job.logs 限制 4000 条，但通常失败时只关心尾部）
    return {
        'taskId': tid,
        'status': job.status,
        'logs': list(job.logs or [])[-200:],
        'runDir': os.path.basename(job.run_dir) if job.run_dir else '',
    }


@router.get('/media/{jobdir}/{filename}')
async def media(jobdir: str, filename: str):
    if not _SAFE.match(jobdir) or not _SAFE.match(filename):
        return JSONResponse(status_code=400, content={'error': '非法文件名'})
    base = os.path.abspath(rh.VIDEOS_DIR)
    target = os.path.abspath(os.path.join(base, jobdir, filename))
    if not target.startswith(base + os.sep) or not os.path.isfile(target):
        return JSONResponse(status_code=404, content={'error': '文件不存在'})
    return FileResponse(target)


# ═══════════════════════ 导演台 Krea2 / Krea2-muse 生图（独立复用，不依赖 8765） ═══════════════
# 复用 rh_h3_web 的 img_submit/img_watch/IMG_WF_REGISTRY（内部直连 RunningHub 平台，
# 自杀链免扣费机制与视频一致），8765 端口停用也能独立生成、获取图片。

def _image_refs(body: dict):
    """收集图生图参考图：显式 refs[] 为主，兼容 firstFrameUrl/imageUrl；下载为本地路径。
    支持 data:image base64（前端本地图直传）→ 落盘 web/image/_uploads/ 供 img_submit 使用。"""
    refs = []
    seen = set()
    _main = body.get('firstFrameUrl') or body.get('imageUrl') or body.get('first_frame')
    if _main:
        seen.add(str(_main))
        rf = rh._rh_dl_ref(str(_main))
        if rf:
            refs.append(rf)
    _reg_refs = body.get('refs') or []
    if not isinstance(_reg_refs, list):
        _reg_refs = [_reg_refs] if _reg_refs else []
    for u in _reg_refs:
        u = str(u or '').strip()
        if not u or u in seen:
            continue
        seen.add(u)
        rf = None
        if u.startswith('data:image'):
            try:
                import base64 as _b64
                _hdr, _data = u.split(',', 1)
                _ext = 'png'
                if 'png' in _hdr:
                    _ext = 'png'
                elif 'jpeg' in _hdr or 'jpg' in _hdr:
                    _ext = 'jpg'
                elif 'webp' in _hdr:
                    _ext = 'webp'
                _ud = os.path.abspath(os.path.join(rh.WEB_ROOT, 'image', '_uploads'))
                os.makedirs(_ud, exist_ok=True)
                _fp = os.path.join(_ud, 'ref_%s.%s' % (tid_suffix(), _ext))
                with open(_fp, 'wb') as _f:
                    _f.write(_b64.b64decode(_data))
                rf = _fp
            except Exception:
                rf = None
        elif u.startswith('http://') or u.startswith('https://'):
            # 公网 URL → 下载到本地
            rf = rh._rh_dl_ref(u)
        else:
            # RunningHub fileName（如 api/xxx.png）→ 直接透传，工作流 LoadImage 节点认这个格式
            rf = u
        if rf and rf not in refs:
            refs.append(rf)
    return refs


def tid_suffix():
    import time as _t
    return _t.strftime('%H%M%S') + ''.join(os.urandom(2).hex())


def _absolute_url(request: Request, path: str) -> str:
    """把相对路径（/api/daotai/...）拼成绝对 URL。

    原因：前端部署在 Vercel，<img src="/api/daotai/..."> 会解析到 Vercel 域名 → 404。
    后端用 request.base_url（uvicorn 默认开 proxy-headers，会读 X-Forwarded-Proto）
    拼出真实部署 URL，前端无需任何转换就能正确加载。

    - 本地开发：base_url = http://localhost:9000/
    - Railway 生产：base_url = https://xxx.up.railway.app/
    """
    p = str(path or '')
    if not p.startswith('/'):
        return p
    return str(request.base_url).rstrip('/') + p


def _img_media_url(rel: str):
    """把 rh.img_poll 返回的 web/ 根相对路径（/image/20261018xxx/img.png）转本服务 URL。"""
    rel = str(rel or '')
    if rel.startswith('/image/'):
        rest = rel[len('/image/'):].strip('/')
        parts = [p for p in rest.split('/') if p]
        if len(parts) >= 2:
            return '/api/daotai/image/media/' + urllib.parse.quote(parts[0]) + '/' + '/'.join(
                urllib.parse.quote(p) for p in parts[1:])
        if len(parts) == 1:
            return '/api/daotai/image/media/' + urllib.parse.quote(parts[0])
    return rel


@router.post('/image')
async def submit_image(request: Request):
    """提交图片生成任务（导演台 Krea2 / Krea2-muse / Qwen-Image 等，免扣费自杀链）。
    body: model / workflow_id(可选) / prompt / refs[] / ratio / megapixels / batch / instance"""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={'error': 'bad json'})
    key = ''
    auth = request.headers.get('Authorization', '')
    if auth.lower().startswith('bearer '):
        key = auth[7:].strip()
    if not key:
        key = (os.environ.get('DAOTAI_API_KEY')
               or os.environ.get('RUNNINGHUB_API_KEY')
               or '').strip()
    if not key:
        return JSONResponse(status_code=400, content={'error': '缺少 Authorization: Bearer <apiKey>（或服务端未配置 DAOTAI_API_KEY 环境变量）'})
    model = str(body.get('model') or body.get('key') or '')
    if model not in rh.RH_IMAGE_MODELS:
        model = 'krea2-muse' if (body.get('refs') or []) else 'krea2'
    _wid = str(body.get('workflow_id') or body.get('wf') or '')
    if not _wid:
        for _wfid, _meta in rh.IMG_WF_REGISTRY.items():
            if _meta.get('key') == model:
                _wid = _wfid
                break
    if _wid not in rh.IMG_WF_REGISTRY:
        _wid = rh.RH_IMG_WFID
    cfg = {
        'workflow_id': _wid, 'api_key': key,
        'instance': body.get('instance') or 'plus',
        'prompt': body.get('prompt') or '',
        'mode': 'i2i' if (body.get('refs') or []) else 't2i', 'optimize': bool(body.get('optimize')),
        'ratio': rh._rh_map_ratio(body.get('ratio') or body.get('size') or ''),
        'megapixels': float(body.get('megapixels') or body.get('pixels') or 2),
        'batch': int(body.get('n') or body.get('batch') or body.get('num') or 1),
        'refs': _image_refs(body),
    }
    try:
        tid, logs, nw = rh.img_submit(cfg)
    except Exception as e:
        _err = str(e)
        # 平台错误：work flow 失效 / 鉴权失败 / 限流 → 502（不要返回 500 让用户误以为是后端 bug）
        if 'workflow not exists' in _err or 'workflow不存在' in _err:
            _msg = ('RunningHub 工作流不可用（workflow not exists）。'
                    '请到 https://www.runninghub.ai 确认该工作流还在你账户下，'
                    '或更换 IMG_WF_REGISTRY 中的可用工作流 ID。'
                    '原始错误: ') + _err
            return JSONResponse(status_code=502, content={'error': _msg, 'kind': 'platform_workflow_missing'})
        if 'user not exist' in _err or 'code 301' in _err or 'apiKey' in _err.lower():
            return JSONResponse(status_code=401, content={'error': 'API Key 无效或账户不存在（' + _err + '）。请到 RunningHub 平台重新生成 API Key。', 'kind': 'platform_auth_invalid'})
        if 'API Key' in _err and ('无效' in _err or '失效' in _err):
            return JSONResponse(status_code=401, content={'error': _err, 'kind': 'platform_auth_invalid'})
        if '频率' in _err or 'rate' in _err.lower() or 'too many' in _err.lower() or 'code 380' in _err or 'code 429' in _err:
            return JSONResponse(status_code=429, content={'error': _err, 'kind': 'platform_rate_limit'})
        # 真后端 bug 才返回 500
        import traceback as _tb
        _tb.print_exc()
        return JSONResponse(status_code=500, content={'error': _err, 'kind': 'backend_error', 'trace': _tb.format_exc()[-500:]})
    rh.RH_OPENAPI[str(tid)] = {'kind': 'image', 'api_key': key, 'task_id': str(tid)}
    rh.RH_OPENAPI_LIVE[str(tid)] = True
    threading.Thread(target=rh.img_watch, args=(str(tid), key), daemon=True).start()
    return {
        'taskId': str(tid), 'task_id': str(tid),
        'localDir': os.path.basename(rh.IMG_DIRS.get(str(tid), '') or ''),
        'logs': logs,
    }


@router.get('/image/media/{jobdir}/{filename}')
async def image_media(jobdir: str, filename: str):
    """图片产物静态服务：web/image/年月日+随机/xxx.png。"""
    if not _SAFE.match(jobdir) or not _SAFE.match(filename):
        return JSONResponse(status_code=400, content={'error': '非法文件名'})
    base = os.path.abspath(os.path.join(rh.WEB_ROOT, 'image'))
    target = os.path.abspath(os.path.join(base, jobdir, filename))
    if not target.startswith(base + os.sep) or not os.path.isfile(target):
        return JSONResponse(status_code=404, content={'error': '文件不存在'})
    return FileResponse(target)


@router.get('/image/models')
async def image_models():
    """导演台图片模型列表（IMG_WF_REGISTRY），供前端引擎切换下拉。"""
    return {'models': rh._img_workflows_json()}
