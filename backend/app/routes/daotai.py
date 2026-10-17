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
import urllib.parse
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, FileResponse

# ── rh_h3_web 核心模块（8765 导演台，__main__ 保护可安全 import）──────────
RH_H3_DIR = os.environ.get(
    'RH_H3_DIR',
    '/Users/kenyou/Doubao/chats/2026-09-17/new-chat-1/runninghub-h3-console/web',
)
if str(RH_H3_DIR) not in sys.path:
    sys.path.insert(0, str(RH_H3_DIR))

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
    if not key:
        return JSONResponse(status_code=400, content={'error': '缺少 Authorization: Bearer <apiKey>'})

    prompt = body.get('prompt') or ''
    if not prompt.strip():
        return JSONResponse(status_code=400, content={'error': 'prompt 不能为空'})

    _wfid = str(body.get('workflow_id') or rh.RH_VIDEO_WFID)
    if not body.get('workflow_id') and rh.MODEL_LOCK.get('video'):
        _wfid = rh.MODEL_LOCK['video']

    refs = _video_refs(body)
    shots_per_seg = max(1, int(body.get('shots_per_seg') or 1))
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
        return JSONResponse(status_code=500, content={'error': f'Job 创建失败: {e}'})
    with rh.JOBS_LOCK:
        rh.JOBS[job.id] = job
    job.thread = __import__('threading').Thread(target=rh.run_job, args=(job,), daemon=True)
    job.thread.start()
    rh.RH_OPENAPI[job.id] = {'kind': 'video', 'job_id': job.id, 'api_key': key}
    rh._emit(f'[daotai] 视频已提交 {job.id}（model=minimaxh3，refs={len([r for r in refs if r])}，'
             f'shots_per_seg={shots_per_seg}，loop_routes={cfg["loop_routes"]}）')
    return {'taskId': job.id, 'task_id': job.id}


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
        return {'status': 'FAILED', 'message': 'daotai 仅支持视频任务'}
    job = rh.JOBS.get(ent['job_id'])
    if not job:
        return {'status': 'FAILED', 'message': 'job lost'}
    snap = rh.job_snapshot(job)
    stt = snap.get('status')
    if stt == 'finished' and snap.get('final_url'):
        _dir = os.path.basename(job.run_dir) if job.run_dir else ''
        _fname = os.path.basename(snap['final_url'])
        u = f'/api/daotai/media/{_dir}/{urllib.parse.quote(_fname)}'
        return {'status': 'SUCCESS', 'video_url': u, 'output': {'video_url': u}, 'url': u}
    if stt == 'finished' and not snap.get('final_url'):
        return {'status': 'FAILED', 'message': '视频合成失败：最终视频未生成（段视频已落盘，可走 bind-local-video 兜底）'}
    if stt in ('failed', 'stopped'):
        return {'status': 'FAILED', 'message': '视频任务失败: ' + str(stt)}
    return {'status': 'PROCESSING', 'taskId': tid}


@router.get('/media/{jobdir}/{filename}')
async def media(jobdir: str, filename: str):
    if not _SAFE.match(jobdir) or not _SAFE.match(filename):
        return JSONResponse(status_code=400, content={'error': '非法文件名'})
    base = os.path.abspath(rh.VIDEOS_DIR)
    target = os.path.abspath(os.path.join(base, jobdir, filename))
    if not target.startswith(base + os.sep) or not os.path.isfile(target):
        return JSONResponse(status_code=404, content={'error': '文件不存在'})
    return FileResponse(target)
