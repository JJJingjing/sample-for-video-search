<<<<<<< HEAD
# 视频搜索前端

这是一个简单的视频搜索前端应用，用于连接 API Gateway 和 CloudFront 资源。

## 功能

- 支持文本搜索和场景搜索两种模式
- 显示视频搜索结果，包括视频片段和相关文本
- 自动将视频定位到相关的时间点
- 显示时间戳信息

## 文件结构

- `index.html` - 主页面
- `app.js` - 应用逻辑
- `config.js` - 配置文件（将由 CDK 部署过程替换）

## 部署说明

此前端已集成到 CDK 堆栈中，部署 CDK 堆栈时会自动部署前端。

## 使用方法

1. 在搜索框中输入关键词
2. 选择搜索模式（文本搜索或场景搜索）
3. 点击搜索按钮
4. 查看返回的视频结果
=======
# Video Search Frontend

This is a simple video search frontend application used to connect to API Gateway and CloudFront resources.

## Features

- Supports two search modes: text search and scene search
- Displays video search results, including video clips and related text
- Automatically positions videos to relevant timestamps
- Displays timestamp information

## File Structure

- `index.html` - Main page
- `app.js` - Application logic
- `config.js` - Configuration file (will be replaced during the CDK deployment process)

## Deployment Instructions

This frontend is integrated into the CDK stack and will be automatically deployed when deploying the CDK stack.

## Usage

1. Enter keywords in the search box
2. Select the search mode (text search or scene search)
3. Click the search button
4. View the returned video results
>>>>>>> dev
