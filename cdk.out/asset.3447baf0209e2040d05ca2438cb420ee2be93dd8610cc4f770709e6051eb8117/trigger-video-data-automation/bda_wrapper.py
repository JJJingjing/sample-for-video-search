import string
from random import random

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

# allows to call the bda api directly, until the SDK gets released, then we can replace it with boto3 methods
def bda_sdk(bda_client_runtime, url_path ="data-automation-projects/", method ="POST", service ="bedrock", payload={}, control_plane = True):
    host = bda_client_runtime.meta.endpoint_url.replace("https://", "")
    url = f"{bda_client_runtime.meta.endpoint_url}/{url_path}"
    if control_plane:
        host = re.sub(r'.runtime+', '', host)
        url = re.sub(r'.runtime+', '', url)

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

# get the project arn based on the name
def get_project_arn(project_name):
    list_results = bda_sdk(bda_client_runtime=bda_client_runtime, url_path="data-automation-projects/", method="POST",
                           payload={})
    # get the project arn
    projects_filtered = [item for item in list_results["projects"] if project_name == item["projectName"]]
    if len(projects_filtered) == 0:
        raise Exception(f"Project {project_name} not found")
    project_arn = projects_filtered[0]["projectArn"]
    return project_arn

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
    # "blueprints" : [
        # {"blueprintArn": blueprint_arn}
        # ]
    }

    response = bda_client_runtime.invoke_data_automation_async(**payload)
    print(response)
    return response

