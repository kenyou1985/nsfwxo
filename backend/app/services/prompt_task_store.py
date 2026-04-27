"""Async Prompt Task Storage - 异步任务存储，支持后台执行和轮询恢复"""

import json
import time
import uuid
import threading
from typing import Any, Optional
from dataclasses import dataclass, field, asdict
from enum import Enum

TASK_TTL_SECONDS = 3600  # 1小时后自动过期


class TaskStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"


@dataclass
class PromptTask:
    task_id: str
    task_type: str  # "themes" | "outline" | "script"
    status: str
    created_at: float
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    result: Optional[dict] = None
    error: Optional[str] = None
    params: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


class TaskStore:
    """Thread-safe in-memory task store with TTL cleanup."""

    def __init__(self):
        self._tasks: dict[str, PromptTask] = {}
        self._lock = threading.RLock()
        self._cleanup_thread: Optional[threading.Thread] = None
        self._stop_cleanup = threading.Event()

    def _ensure_cleanup(self):
        if self._cleanup_thread is None:
            self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
            self._cleanup_thread.start()

    def _cleanup_loop(self):
        while not self._stop_cleanup.wait(60):
            self._cleanup()

    def _cleanup(self):
        now = time.time()
        with self._lock:
            expired = [
                tid for tid, task in self._tasks.items()
                if task.status in (TaskStatus.DONE, TaskStatus.FAILED)
                and (now - task.completed_at) > TASK_TTL_SECONDS
            ]
            for tid in expired:
                del self._tasks[tid]

    def create(self, task_type: str, params: dict) -> PromptTask:
        task_id = str(uuid.uuid4())
        task = PromptTask(
            task_id=task_id,
            task_type=task_type,
            status=TaskStatus.PENDING,
            created_at=time.time(),
            params=params,
        )
        with self._lock:
            self._tasks[task_id] = task
        self._ensure_cleanup()
        return task

    def get(self, task_id: str) -> Optional[PromptTask]:
        with self._lock:
            return self._tasks.get(task_id)

    def update(self, task_id: str, **kwargs) -> Optional[PromptTask]:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return None
            for k, v in kwargs.items():
                setattr(task, k, v)
            return task

    def mark_running(self, task_id: str) -> Optional[PromptTask]:
        return self.update(task_id, status=TaskStatus.RUNNING, started_at=time.time())

    def mark_done(self, task_id: str, result: dict) -> Optional[PromptTask]:
        return self.update(
            task_id,
            status=TaskStatus.DONE,
            completed_at=time.time(),
            result=result,
        )

    def mark_failed(self, task_id: str, error: str) -> Optional[PromptTask]:
        return self.update(
            task_id,
            status=TaskStatus.FAILED,
            completed_at=time.time(),
            error=error,
        )


# Global singleton
_task_store: Optional[TaskStore] = None


def get_task_store() -> TaskStore:
    global _task_store
    if _task_store is None:
        _task_store = TaskStore()
    return _task_store
