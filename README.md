
=======
# 语言选择 / Language Selection
- [中文](#中文说明)
- [English](README.en.md)

>>>>>>> dev
# 视频搜索应用 (sample-for-video-search)

这是一个基于 AWS CDK 构建的视频搜索应用，使用 Amazon Bedrock 和 DocumentDB 实现视频内容的智能搜索功能。该应用允许用户通过文本描述或场景描述搜索视频内容，并精确定位到相关时间点。

## 许可证

本项目使用 [MIT-0 许可证](LICENSE)。

## 第三方组件

本项目使用了多个第三方开源组件。有关详细信息，请参阅 [THIRD-PARTY.md](THIRD-PARTY.md) 文件。

## 架构概览

该应用包含以下主要组件：

- **前端**：基于 HTML/CSS/JavaScript 的简单 Web 应用
- **API Gateway**：处理前端请求
- **Lambda 函数**：处理搜索逻辑和视频数据提取
- **DocumentDB**：存储视频元数据和搜索索引
- **Amazon Bedrock**：提供 AI 能力，用于视频内容理解和搜索
- **S3**：存储视频文件和处理结果
- **CloudFront**：提供内容分发

## 功能特点

- **多模式搜索**：支持文本搜索和场景搜索两种模式
- **精确定位**：自动将视频定位到相关的时间点
- **相似度排序**：搜索结果按相关度排序显示
- **自动处理**：新上传的视频自动进行处理和索引
- **可扩展架构**：基于无服务器架构，可根据需求自动扩展

## 前提条件

- [AWS 账户](https://aws.amazon.com/)
- [AWS CLI](https://aws.amazon.com/cli/) 已安装并配置
- [Node.js](https://nodejs.org/) (≥ 14.x) 和 [npm](https://www.npmjs.com/)
- [AWS CDK](https://aws.amazon.com/cdk/) 已安装 (`npm install -g aws-cdk`)
- [Python](https://www.python.org/) 3.11 或更高版本

## 部署指南

### 1. 设置 Python 虚拟环境

推荐使用虚拟环境来隔离项目依赖：

```bash
# 创建虚拟环境
python -m venv .venv

# 激活虚拟环境
## Windows
.venv\Scripts\activate
## macOS/Linux
source .venv/bin/activate

# 验证虚拟环境
which python  # 应显示虚拟环境中的 Python 路径
```

激活虚拟环境后，终端提示符前会出现 `(.venv)`，表示当前在虚拟环境中。所有后续的 Python 包安装都将在这个隔离的环境中进行。

### 2. 克隆仓库

```bash
git clone <repository-url>
<<<<<<< HEAD
cd VideoSearchStack123
=======
cd sample-for-video-search
>>>>>>> dev
```

### 3. 安装依赖

```bash
# 安装 CDK 依赖
npm install

# 安装 Lambda 层依赖
cd assets/lambda-layer
pip install -r requirements.txt -t python
cd ../..
```

### 4. 配置 AWS 环境

确保您的 AWS CLI 已正确配置，并具有足够的权限：

```bash
aws configure
```

### 5. 引导 CDK 环境（首次使用 CDK 时）

```bash
cdk bootstrap
```

### 6. 部署堆栈

```bash
cdk deploy
```

部署完成后，CDK 将输出以下信息：

- **FrontendURL**: 前端应用的 URL
- **ApiEndpoint**: API Gateway 的 URL
- **UnifiedBucketName**: S3 存储桶名称
- **DocumentDBEndpoint**: DocumentDB 集群端点

### 7. 上传视频

您可以使用 AWS 控制台或 AWS CLI 将视频上传到 S3 存储桶的 `video-input` 文件夹：

```bash
aws s3 cp your-video.mp4 s3://<UnifiedBucketName>/video-input/
```

上传后，系统将自动处理视频并创建搜索索引。

## 使用指南

1. 访问部署后提供的 **FrontendURL**
2. 在搜索框中输入关键词或场景描述
3. 选择搜索模式（文本搜索或场景搜索）
4. 点击搜索按钮
5. 查看结果，结果将按相关度排序
6. 点击视频可从相关时间点开始播放

## 自定义和配置

### 修改前端

前端文件位于 `assets/frontend` 目录中：

- `index.html`: 主页面结构
- `app.js`: 应用逻辑
- `config.js`: 配置文件（由 CDK 自动生成）

### 修改 Lambda 函数

Lambda 函数位于 `assets/lambda` 目录中：

- `search-video`: 处理搜索请求
- `extract-video-data`: 处理视频数据提取
- `create-bda-project`: 创建 Bedrock Data Automation 项目
- `trigger-video-data-automation`: 触发视频数据自动化处理
- `init-db`: 初始化数据库

### 修改 CDK 堆栈

主要的 CDK 堆栈定义位于 `video-search-stack.ts` 文件中。

## 清理资源

要删除所有创建的资源，请运行：

```bash
cdk destroy
```

完成后，可以退出虚拟环境：

```bash
deactivate
```

如果需要完全删除虚拟环境，可以直接删除 `.venv` 目录。

## 故障排除

- **前端无法连接到 API**: 检查 `config.js` 文件中的 API 端点是否正确
- **视频无法播放**: 确认视频已上传到正确的 S3 路径，并且 CloudFront 分配已配置正确
- **搜索无结果**: 检查 DocumentDB 连接和索引是否正确创建
- **Lambda 函数超时**: 考虑增加 Lambda 函数的超时设置和内存分配
- **虚拟环境问题**: 如果遇到 Python 包冲突或版本问题，尝试删除并重新创建虚拟环境

## 安全注意事项

- 该应用使用 DocumentDB 用户名和密码进行身份验证，生产环境中应使用 AWS Secrets Manager 管理这些凭据
- API Gateway 配置为允许所有源，生产环境中应限制为特定域名
- S3 存储桶配置为阻止公共访问，通过 CloudFront 提供内容
- 虚拟环境中的依赖包应定期更新，以修复潜在的安全漏洞
