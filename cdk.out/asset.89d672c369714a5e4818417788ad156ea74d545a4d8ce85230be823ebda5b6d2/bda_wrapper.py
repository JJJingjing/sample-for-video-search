import boto3
import json
import os
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
import requests
import re

ENDPOINT_RUNTIME = os.environ.get('BDA_RUNTIME_ENDPOINT', None)
DEPLOY_REGION = os.environ.get('DEPLOY_REGION', 'us-east-1')  # 从环境变量获取区域

# Create a Bedrock client
bda_client_runtime = boto3.client("bedrock-data-automation-runtime",
                                region_name=DEPLOY_REGION,  # 使用环境变量中的区域
                                **({'endpoint_url': ENDPOINT_RUNTIME} if ENDPOINT_RUNTIME is not None else {}),
                                verify=True)

# 创建 bedrock-data-automation 客户端
bda_client = boto3.client('bedrock-data-automation', region_name=DEPLOY_REGION)

# 获取项目 ARN 的函数，使用标准 boto3 API 调用
def get_project_arn(project_name):
    try:
        # 使用标准 API 调用列出项目
        response = bda_client.list_data_automation_projects()
        projects = response.get('projects', [])
        
        # 打印项目列表，用于调试
        print(f"Available projects: {projects}")
        
        # 过滤出匹配的项目
        projects_filtered = [item for item in projects if project_name == item.get('projectName')]
        if len(projects_filtered) == 0:
            # 如果找不到项目，尝试创建一个
            print(f"Project {project_name} not found, attempting to create it")
            try:
                create_response = bda_client.create_data_automation_project(
                    dataProjectName=project_name,
                    description=f"Video data project created automatically for {DEPLOY_REGION}"
                )
                print(f"Project created: {create_response}")
                # 重新获取项目列表
                response = bda_client.list_data_automation_projects()
                projects = response.get('projects', [])
                projects_filtered = [item for item in projects if project_name == item.get('projectName')]
                if len(projects_filtered) == 0:
                    raise Exception(f"Failed to create project {project_name}")
            except Exception as create_error:
                print(f"Error creating project: {str(create_error)}")
                raise Exception(f"Project {project_name} not found and could not be created: {str(create_error)}")
        
        project_arn = projects_filtered[0].get('projectArn')
        print(f"Found project ARN: {project_arn}")
        return project_arn
    except Exception as e:
        print(f"Error getting project ARN: {str(e)}")
        raise

# 保留原始 bda_sdk 函数，以防需要
def bda_sdk(bda_client_runtime, url_path="data-automation-projects/", method="POST", service="bedrock", payload={}, control_plane=True):
    host = bda_client_runtime.meta.endpoint_url.replace("https://", "")
    url = f"{bda_client_runtime.meta.endpoint_url}/{url_path}"
    if control_plane:
        host = re.sub(r'-runtime', '', host)
        url = re.sub(r'-runtime', '', url)

    session = boto3.Session()

    request = AWSRequest(
        method,
        url,
        headers={'Host': host}
    )

    region = bda_client_runtime.meta.region_name
    SigV4Auth(session.get_credentials(), service, region).add_auth(request)
    headers = dict(request.headers)
    response = requests.request(method, url, headers=headers, data=payload, timeout=5)
    print(f"Response: {response}")
    content = response.content.decode("utf-8")
    data = json.loads(content)
    return data

# invokes bda by async approach with a given input file
def invoke_insight_generation_async(
        input_s3_uri,
        output_s3_uri,
        data_project_arn, blueprints = None):

    payload = {
        "inputConfiguration": {
            "s3Uri": input_s3_uri
        },
        "outputConfiguration": {
            "s3Uri": output_s3_uri
        },
        "dataAutomationConfiguration": {
            "dataAutomationArn": data_project_arn,
        },
        "notificationConfiguration": {
            "eventBridgeConfiguration": {"eventBridgeEnabled": True},
        }
    }

    try:
        response = bda_client_runtime.invoke_data_automation_async(**payload)
        print(f"Successfully invoked data automation: {response}")
        return response
    except Exception as e:
        print(f"Error invoking data automation: {str(e)}")
        raise
