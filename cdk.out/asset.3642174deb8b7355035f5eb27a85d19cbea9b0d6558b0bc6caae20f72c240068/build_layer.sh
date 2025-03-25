#!/bin/bash
# 构建Lambda Layer

# 确保我们在正确的目录
cd "$(dirname "$0")"

# 创建临时目录
mkdir -p python

# 安装依赖项到python目录
pip install -r requirements.txt -t python

# 显示安装的包
echo "Installed packages:"
ls -la python

echo "Layer build complete!"
