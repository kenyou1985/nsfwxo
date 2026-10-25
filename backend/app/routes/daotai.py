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
import urllib.request
import base64
import io
import asyncio
import subprocess
import shutil
import uuid
import time
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


def _video_ref_value(u: str):
    """Resolve a data URL, public URL, or RunningHub fileName to a local/loadable ref."""
    u = (u or '').strip()
    if not u:
        return None
    if u.startswith('data:image'):
        try:
            import base64 as _b64
            _hdr, _data = u.split(',', 1)
            _ext = 'png' if 'png' in _hdr else 'jpg' if ('jpeg' in _hdr or 'jpg' in _hdr) else 'webp' if 'webp' in _hdr else 'png'
            _ud = os.path.abspath(os.path.join(rh.WEB_ROOT, 'image', '_uploads'))
            os.makedirs(_ud, exist_ok=True)
            _fp = os.path.join(_ud, 'video_ref_%s.%s' % (int(time.time() * 1000), _ext))
            with open(_fp, 'wb') as _f:
                _f.write(_b64.b64decode(_data))
            return _fp
        except Exception:
            return None
    if u.startswith('http://') or u.startswith('https://'):
        return rh._rh_dl_ref(u)
    return u


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
        rf = _video_ref_value(str(_main))
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
            # 不按 URL 去重：九宫格逐格任务会把同一格重复填满 5 个参考槽，
            # 去重会导致只有 ref_0 有图，其余槽沿用画布默认参考图。
            rf = _video_ref_value(mu)
            if rf:
                refs.append(rf)
    # 只保留首帧一个参考图；其余槽由运行时显式清空为 None，避免重复参考图导致 H3 生成多个人物
    if refs:
        refs = [refs[0]]
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

    # ===== 火宝桥接：复用 8765 导演台（已验证可出片），绕开本地 det16 假成功 =====
    if body.get('use_bridge'):
        _media = []
        if body.get('firstFrameUrl'):
            _media.append({'type': 'first_frame', 'url': body.get('firstFrameUrl')})
        for m in (body.get('media') or []):
            if isinstance(m, dict) and m.get('url'):
                _media.append({'type': m.get('type') or 'reference_image', 'url': m['url']})
        _p = {
            'prompt': prompt,
            'media': _media,
            'workflow_id': str(body.get('workflow_id') or '2110330160000516098'),
            'target_segs': int(body.get('target_segs') or 2),
            'duration': int(body.get('duration') or 15),
            'resolution': float(body.get('resolution') or 0.4),
            'shots_per_segment': int(body.get('shots_per_seg') or 1),
            'generate_audio': False,
        }
        try:
            _req = urllib.request.Request(
                'http://127.0.0.1:8765/openapi/v2/minimaxh3',
                data=json.dumps(_p).encode(),
                headers={'Content-Type': 'application/json',
                         'Authorization': 'Bearer ' + key})
            _raw = await asyncio.to_thread(lambda: urllib.request.urlopen(_req, timeout=60).read().decode())
            _resp = json.loads(_raw)
            _tid = str(_resp.get('taskId') or _resp.get('task_id') or '')
            if not _tid:
                return JSONResponse(status_code=502, content={'error': '8765 未返回 taskId', 'raw': _resp})
            rh.RH_OPENAPI[_tid] = {'kind': 'video_bridge', 'api_key': key, 'task_id': _tid}
            return {'taskId': _tid, 'task_id': _tid, 'bridge': True}
        except Exception as _e:
            return JSONResponse(status_code=502, content={'error': '8765 桥接提交失败: ' + str(_e)})

    _wfid = str(body.get('workflow_id') or rh.RH_VIDEO_WFID)
    if not body.get('workflow_id') and rh.MODEL_LOCK.get('video'):
        _wfid = rh.MODEL_LOCK['video']

    refs = await asyncio.to_thread(_video_refs, body)
    # 2026-10-22 防"参考图静默丢失"：请求里带了参考图但一张都没落地时直接报错。
    # 否则工作流 LoadImage 28/273/285 会沿用画布上一次保存的旧图 →
    # 生成出来的不是用户选的人（首段尤其明显：等于把旧参考图做成贴图动画）。
    _want_refs = bool(
        body.get('firstFrameUrl') or body.get('first_frame') or body.get('imageUrl')
        or (isinstance(body.get('media'), list)
            and any(isinstance(m, dict) and m.get('url') for m in body['media']))
    )
    if not any(refs):
        return JSONResponse(status_code=400, content={
            'error': '参考图未落地（firstFrameUrl/media 为空或下载失败）——已中止提交，'
                     '避免工作流沿用画布旧参考图生成错误人物。请重新选择数字人或上传图片后重试。',
            'kind': 'ref_missing',
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
        'no_llm': bool(body.get('no_llm')),
    }
    try:
        job = await asyncio.to_thread(rh.Job, cfg)
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
    rh._emit(f'[daotai] 视频已提交 {job.id}（model=minimaxh3，refs={len([r for r in refs if r])}，ref0={os.path.basename(refs[0]) if refs and refs[0] else "NONE"}，'
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
            st, urls, local, th, logs = await asyncio.to_thread(
                rh.img_poll, tid, ent.get('api_key') or '')
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
    if ent.get('kind') == 'video_bridge':
        try:
            _req = urllib.request.Request(
                'http://127.0.0.1:8765/openapi/v2/query',
                data=json.dumps({'taskId': tid}).encode(),
                headers={'Content-Type': 'application/json',
                         'Authorization': 'Bearer ' + (ent.get('api_key') or '')})
            _raw = await asyncio.to_thread(lambda: urllib.request.urlopen(_req, timeout=30).read().decode())
            _data = json.loads(_raw)
        except Exception as _e:
            return {'status': 'PROCESSING', 'taskId': tid, 'message': '8765 query: ' + str(_e)}
        _st = str(_data.get('status') or '').upper()
        if _st in ('SUCCESS', 'COMPLETED', 'FINISHED'):
            _u = (_data.get('video_url') or _data.get('url')
                  or (_data.get('output') or {}).get('video_url') or '')
            if isinstance(_u, str) and _u.startswith('/'):
                _u = 'http://127.0.0.1:8765' + _u
            if isinstance(_u, str) and _u:
                _u = urllib.parse.quote(_u, safe=':/?&=#%')
            if _u:
                return {'status': 'SUCCESS', 'video_url': _u, 'output': {'video_url': _u}, 'url': _u}
            return {'status': 'FAILED', 'message': '8765 返回成功但没有 video_url'}
        if _st in ('FAILED', 'ERROR', 'STOPPED'):
            return {'status': 'FAILED', 'message': _data.get('message') or _data.get('error') or '8765 任务失败'}
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
        # 段视频已落盘但合并失败：直接在这里补一次 ffmpeg 合并
        try:
            import glob as _glob
            _paths = sorted(_glob.glob(os.path.join(job.run_dir, 'seg_*.mp4')))
            if len(_paths) >= 1:
                _out = os.path.join(job.run_dir, '最终视频.mp4')
                if rh._concat_videos(job, _paths, _out) and os.path.exists(_out):
                    _dir = os.path.basename(job.run_dir)
                    _u = _absolute_url(request, f'/api/daotai/media/{_dir}/{urllib.parse.quote(os.path.basename(_out))}')
                    return {'status': 'SUCCESS', 'video_url': _u, 'output': {'video_url': _u}, 'url': _u}
        except Exception:
            pass
        return {'status': 'FAILED', 'message': '视频合成失败：最终视频未生成（段视频已落盘，可走 bind-local-video 兜底）'}
    if stt in ('failed', 'stopped'):
        # 成片已存在却误报失败 → 直接恢复成功
        _fu = snap.get('final_url')
        if _fu:
            _dir = os.path.basename(job.run_dir) if job.run_dir else ''
            _u = _absolute_url(request, f'/api/daotai/media/{_dir}/{urllib.parse.quote(os.path.basename(_fu))}')
            return {'status': 'SUCCESS', 'video_url': _u, 'output': {'video_url': _u}, 'url': _u, 'recovered': True}
        try:
            import glob as _glob
            _paths = [x for x in sorted(_glob.glob(os.path.join(job.run_dir, 'seg_*.mp4'))) if os.path.getsize(x) > 1024]
            if _paths:
                _out = os.path.join(job.run_dir, '最终视频.mp4')
                if rh._concat_videos(job, _paths, _out) and os.path.exists(_out):
                    _dir = os.path.basename(job.run_dir)
                    _u = _absolute_url(request, f'/api/daotai/media/{_dir}/{urllib.parse.quote(os.path.basename(_out))}')
                    return {'status': 'SUCCESS', 'video_url': _u, 'output': {'video_url': _u}, 'url': _u, 'recovered': True}
        except Exception:
            pass
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


@router.get('/joblog/{jid}')
async def job_log(jid: str):
    job = rh.JOBS.get(jid)
    if not job:
        return {'error': 'no job', 'jid': jid}
    return {'jid': jid, 'status': getattr(job, 'status', ''), 'logs': (getattr(job, 'logs', []) or [])[-150:]}


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


def _read_image_bytes(src: str) -> bytes:
    if str(src).startswith('data:'):
        return base64.b64decode(str(src).split(',', 1)[1])
    req = urllib.request.Request(str(src), headers={'User-Agent': 'Mozilla/5.0'})
    return urllib.request.urlopen(req, timeout=60).read()


def _crop_save_portrait(raw: bytes, request: Request) -> str:
    from PIL import Image, ImageOps
    im = Image.open(io.BytesIO(raw)).convert('RGB')
    w, h = im.size
    cw = int(w * 0.60)
    ch = int(h * 0.42)
    x0 = max(0, (w - cw) // 2)
    y0 = max(0, int(h * 0.12))
    crop = im.crop((x0, y0, x0 + cw, y0 + ch))
    crop = ImageOps.fit(crop, (512, 640), method=Image.LANCZOS, centering=(0.5, 0.35))
    d = os.path.join(rh.VIDEOS_DIR, 'portraits')
    os.makedirs(d, exist_ok=True)
    fn = uuid.uuid4().hex[:12] + '.jpg'
    crop.save(os.path.join(d, fn), quality=92)
    return _absolute_url(request, f'/api/daotai/media/portraits/{fn}')


@router.post('/split-grid')
async def split_grid(request: Request):
    """服务端裁切九宫格：检测白色分隔线得到真实行列，返回每格图片 URL。

    前端 canvas 裁切会因跨域/图片解码失败报“第1格裁切失败”，
    统一改走后端 PIL，稳定拿到 9/10/12 格的每一格。
    """
    from PIL import Image
    try:
        body = await request.json()
    except Exception:
        body = {}
    src = str(body.get('image_url') or '').strip()
    if not src:
        return JSONResponse(status_code=400, content={'error': 'image_url required'})
    try:
        raw = await asyncio.to_thread(_read_image_bytes, src)
        im = Image.open(io.BytesIO(raw)).convert('RGB')
    except Exception as e:
        return JSONResponse(status_code=400, content={'error': f'图片读取失败: {e}'})

    w, h = im.size
    g = im.convert('L')
    px = g.load()
    # 缩略采样检测白色分隔线
    step_x = max(1, w // 300)
    step_y = max(1, h // 300)
    def is_white(x, y):
        return px[x, y] > 238
    v_lines, h_lines = [], []
    for x in range(0, w, step_x):
        n = sum(1 for y in range(0, h, step_y) if is_white(x, y))
        if n / max(1, len(range(0, h, step_y))) > 0.65:
            v_lines.append(x)
    for y in range(0, h, step_y):
        n = sum(1 for x in range(0, w, step_x) if is_white(x, y))
        if n / max(1, len(range(0, w, step_x))) > 0.65:
            h_lines.append(y)
    def groups(arr):
        out = []
        for n in arr:
            if not out or n - out[-1] > max(4, step_x):
                out.append(n)
        return out
    cols = max(1, len(groups(v_lines)) - 1)
    rows = max(1, len(groups(h_lines)) - 1)
    if not (4 <= cols * rows <= 12):
        cols, rows = 3, 3

    out_dir = os.path.join(rh.IMAGES_DIR, 'grid_' + uuid.uuid4().hex[:10])
    os.makedirs(out_dir, exist_ok=True)
    urls = []
    cw, ch = w / cols, h / rows
    for i in range(min(12, cols * rows)):
        r, c = divmod(i, cols)
        box = (int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch))
        crop = im.crop(box)
        fn = f'cell_{i + 1}.jpg'
        crop.save(os.path.join(out_dir, fn), quality=94)
        rel = _img_media_url('/image/' + os.path.basename(out_dir) + '/' + fn)
        urls.append(_absolute_url(request, rel))
    return {'cols': cols, 'rows': rows, 'count': len(urls), 'images': urls}


@router.post('/portrait')
async def extract_portrait(request: Request):
    """从分镜图里裁一张人物头像（启发式：画面中上部、水平居中），
    保存到 videos/portraits/ 并返回 URL，用于 H3 的 <Picture 2> 人物锚定。
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={'error': 'bad json'})
    src = body.get('image_url') or body.get('imageUrl') or body.get('data_url') or ''
    if not src:
        return JSONResponse(status_code=400, content={'error': 'image_url 不能为空'})
    try:
        raw = await asyncio.to_thread(_read_image_bytes, str(src))
        url = await asyncio.to_thread(_crop_save_portrait, raw, request)
        return {'portrait_url': url, 'url': url}
    except Exception as e:
        return JSONResponse(status_code=500, content={'error': '头像提取失败: %s' % e})


@router.post('/concat')
async def concat_videos(request: Request):
    """把多个分镜视频按顺序合成一个最终视频（ffmpeg concat）。

    body: {"videos": ["/api/daotai/media/xxx/a.mp4", ...], "name": "storyboard_final"}
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={'error': 'bad json'})
    videos = body.get('videos') or body.get('urls') or []
    if not isinstance(videos, list) or len(videos) < 1:
        return JSONResponse(status_code=400, content={'error': 'videos 不能为空'})
    if shutil.which('ffmpeg') is None:
        return JSONResponse(status_code=500, content={'error': '服务器未安装 ffmpeg，无法合成'})

    out_dir = os.path.join(rh.VIDEOS_DIR, 'concat_' + uuid.uuid4().hex[:12])
    os.makedirs(out_dir, exist_ok=True)
    local_paths = []
    for idx, u in enumerate(videos):
        u = str(u or '')
        local = None
        # 同源 /api/daotai/media/{dir}/{file} → 直接映射本地文件
        m = re.search(r'/api/daotai/media/([^/]+)/([^?#]+)', u)
        if m:
            d = urllib.parse.unquote(m.group(1))
            f = urllib.parse.unquote(m.group(2))
            cand = os.path.join(rh.VIDEOS_DIR, d, f)
            if os.path.isfile(cand):
                local = cand
        if not local:
            # 远程 URL / 绝对地址 → 下载
            try:
                dst = os.path.join(out_dir, f'src_{idx}.mp4')
                _safe_u = urllib.parse.quote(u, safe=':/?&=#%')
                urllib.request.urlretrieve(_safe_u, dst)
                local = dst
            except Exception as e:
                return JSONResponse(status_code=400, content={'error': f'第 {idx + 1} 个视频下载失败: {e}'})
        local_paths.append(local)

    out_path = os.path.join(out_dir, 'final_concat.mp4')
    list_path = os.path.join(out_dir, 'concat_list.txt')
    with open(list_path, 'w') as f:
        for pth in local_paths:
            f.write("file '%s'\n" % pth.replace("'", "'\\''"))
    # 统一重编码：分镜视频的 PTS 起点不一致，`-c copy` 会把时长累加成 2-3 倍
    # （6 段 26s 合成后变成 6:30，后面全是黑屏）。concat filter 会重置时间戳。
    cmd = ['ffmpeg', '-y']
    for pth in local_paths:
        cmd += ['-i', pth]
    n = len(local_paths)
    filt = ''.join(f'[{i}:v][{i}:a]' for i in range(n)) + f'concat=n={n}:v=1:a=1[v][a]'
    cmd += ['-filter_complex', filt, '-map', '[v]', '-map', '[a]',
            '-fflags', '+genpts', '-r', '30',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
            '-c:a', 'aac', '-b:a', '192k', out_path]
    r2 = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r2.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) < 10240:
        return JSONResponse(status_code=500, content={'error': 'ffmpeg 合成失败: ' + (r2.stderr or '')[-800:]})

    fname = urllib.parse.quote(os.path.basename(out_path))
    return {'video_url': _absolute_url(request, f'/api/daotai/media/{os.path.basename(out_dir)}/{fname}'),
            'filename': os.path.basename(out_path), 'count': len(local_paths)}


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
        'refs': await asyncio.to_thread(_image_refs, body),
    }
    try:
        tid, logs, nw = await asyncio.to_thread(rh.img_submit, cfg)
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
