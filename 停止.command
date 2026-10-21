#!/bin/bash
# nsfwxo 一键停止（macOS）—— 双击停止 启动.command 拉起的全部服务
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
exec ./启动.command --stop
