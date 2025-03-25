import json
import boto3
import os
import time
from botocore.exceptions import ClientError
import pymongo
from pymongo import MongoClient
import re
import sys
import socket
import logging

# Configure logging
log_level = os.environ.get('LOG_LEVEL', 'INFO')
logging.basicConfig(level=getattr(logging, log_level), 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 从环境变量获取区域，默认为 us-east-1
region = os.environ.get('DEPLOY_REGION', 'us-east-1')
logger.info(f"Using region: {region}")

# Initialize Bedrock client
logger.info(f"Initializing Bedrock client in region: {region}")
bedrock_client = boto3.client('bedrock-runtime', region_name=region)

def get_json_from_s3(bucket, key):
    """从S3读取JSON文件"""
    s3_client = boto3.client('s3')
    try:
        response = s3_client.get_object(
            Bucket=bucket,
            Key=key
        )
        content = response['Body'].read().decode('utf-8')
        print(f"Raw content from S3: {content[:200]}...")  # Print first 200 characters
        json_data = json.loads(content)
        print(f"Parsed JSON keys: {list(json_data.keys())}")
        return json_data
    except ClientError as e:
        print(f"Error reading from S3: {e}")
        return None
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON: {e}")
        return None

def extract_video_name(s3_key):
    """从s3_key中提取视频名称（不含扩展名）"""
    # 从路径中获取文件名 (例如从 "video-input/endemo3.mp4" 获取 "endemo3.mp4")
    file_name = s3_key.split('/')[-1]
    # 移除扩展名 (例如从 "endemo3.mp4" 获取 "endemo3")
    video_name = os.path.splitext(file_name)[0]
    return video_name

def get_embeddings(text):
    """生成文本的embedding"""
    if not text:
        return []
    
    # Handle dictionary input
    if isinstance(text, dict):
        print(f"Input is a dictionary. Keys: {list(text.keys())}")
        # If 'text' key exists, use its value, otherwise use the whole dict
        text = text.get('text', json.dumps(text))
    elif not isinstance(text, str):
        print(f"Warning: Input is neither string nor dict. Type: {type(text)}")
        text = str(text)
    
    try:
        response = bedrock_client.invoke_model(
            modelId="amazon.titan-embed-text-v2:0",
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "inputText": text
            })
        )
        
        response_body = json.loads(response['body'].read())
        return response_body['embedding']
    except Exception as e:
        print(f"Error in get_embeddings: {str(e)}")
        print(f"Input text (first 100 chars): {text[:100] if len(text) > 100 else text}")
        raise

def split_transcript_into_chunks(transcript_text, max_chunk_size=500, min_chunk_size=100):
    """
    将文本转录拆分为较小的块，以便更好地进行向量搜索
    
    Args:
        transcript_text: 要拆分的转录文本
        max_chunk_size: 每个块的最大字符数
        min_chunk_size: 每个块的最小字符数
    
    Returns:
        包含文本块的列表
    """
    if not transcript_text:
        return []
    
    # 如果输入是字典，尝试提取文本
    if isinstance(transcript_text, dict):
        if 'text' in transcript_text:
            transcript_text = transcript_text['text']
        elif 'representation' in transcript_text and 'text' in transcript_text['representation']:
            transcript_text = transcript_text['representation']['text']
        else:
            transcript_text = json.dumps(transcript_text)
    
    # 确保输入是字符串
    if not isinstance(transcript_text, str):
        transcript_text = str(transcript_text)
    
    # 按句子分割（句号、问号、感叹号后跟空格）
    # 使用更宽松的模式，允许句子结束后有任何数量的空格
    sentences = re.split(r'([.!?])\s*', transcript_text)
    
    # 处理分割结果，将标点符号重新附加到句子
    processed_sentences = []
    i = 0
    while i < len(sentences):
        sentence = sentences[i]
        
        # 如果是标点符号，附加到前一个句子
        if i > 0 and sentence in ['.', '!', '?']:
            processed_sentences[-1] += sentence
        else:
            processed_sentences.append(sentence)
        
        i += 1
    
    # 将句子组合成块
    chunks = []
    current_chunk = ""
    
    for sentence in processed_sentences:
        # 跳过空句子
        if not sentence.strip():
            continue
            
        # 如果当前块加上新句子会超过最大大小，保存当前块
        if current_chunk and len(current_chunk) + len(sentence) + 1 > max_chunk_size:
            if len(current_chunk) >= min_chunk_size:
                chunks.append(current_chunk.strip())
            current_chunk = sentence
        else:
            if current_chunk:
                current_chunk += " " + sentence
            else:
                current_chunk = sentence
    
    # 添加最后一个块
    if current_chunk and len(current_chunk) >= min_chunk_size:
        chunks.append(current_chunk.strip())
    
    return chunks

import sys
import socket

def test_connection():
    try:
        # 硬编码的连接信息
        username = 'username123'
        password = 'Password123'
        db_endpoint = os.environ.get('DB_ENDPOINT')
        db_port = os.environ.get('DB_PORT', '27017')
        
        if not db_endpoint:
            logger.warning("DB_ENDPOINT environment variable is not set, skipping connection test")
            return
            
        # 如果主机名包含占位符，则跳过测试
        if '${' in db_endpoint:
            logger.info(f"Host contains placeholders, skipping connection test: {db_endpoint}")
            return
            
        logger.info(f"Testing connection to {db_endpoint}:{db_port}")
        socket.create_connection((db_endpoint, int(db_port)), timeout=300)
        logger.info(f"Successfully connected to {db_endpoint}:{db_port}")
    except Exception as e:
        logger.warning(f"Connection test failed: {str(e)}")
        logger.info(f"This may be expected during deployment if the cluster is not yet available")
        # 不抛出异常，让函数继续执行

def store_in_documentdb(data):
    """存储数据到DocumentDB"""
    try:
        # 硬编码的连接信息
        username = 'username123'
        password = 'Password123'
        db_endpoint = os.environ.get('DB_ENDPOINT')
        db_port = os.environ.get('DB_PORT', '27017')
        db_name = os.environ.get('DB_NAME', 'VideoData')
        collection_name = os.environ.get('COLLECTION_NAME', 'videodata')
        
        if not db_endpoint:
            raise ValueError("DB_ENDPOINT environment variable is not set")
        
        # 构建 MongoDB URI
        mongodb_uri = f"mongodb://{username}:{password}@{db_endpoint}:{db_port}/?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&ssl=false"
        logger.info(f"MongoDB URI (redacted): mongodb://{username}:****@{db_endpoint}:{db_port}/?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&ssl=false")
        
        # Create a MongoDB client with increased timeout
        client = MongoClient(
            mongodb_uri, 
            socketTimeoutMS=300000,  # 5分钟
            connectTimeoutMS=300000,  # 5分钟
            serverSelectionTimeoutMS=300000,  # 5分钟
            ssl=False  # 禁用SSL/TLS
        )
        
        # Specify the database and collection
        db = client[db_name]
        collection = db[collection_name]
        
        # Insert the data
        result = collection.insert_one(data)
        logger.info(f"Successfully stored data in DocumentDB with ID: {result.inserted_id}")
        
        # Close the connection
        client.close()
    except pymongo.errors.ServerSelectionTimeoutError as timeout_error:
        logger.error(f"Timeout error connecting to DocumentDB: {str(timeout_error)}")
        logger.error(f"Please check your network connection and DocumentDB cluster status.")
        raise
    except Exception as e:
        logger.error(f"Error connecting to or storing data in DocumentDB: {str(e)}")
        logger.error(f"MongoDB URI (with password redacted): mongodb://{username}:****@{db_endpoint}:{db_port}/?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&ssl=false")
        logger.error(f"Python version: {sys.version}")
        logger.error(f"PyMongo version: {pymongo.__version__}")
        raise

def lambda_handler(event, context):
    try:
        # Test the connection to DocumentDB
        test_connection()

        # 从EventBridge事件中获取bucket和key
        bucket = event['detail']['bucket']['name']
        key = event['detail']['object']['key']
        
        print(f"Attempting to read JSON from S3: {bucket}/{key}")
        # 读取JSON文件内容
        video_data = get_json_from_s3(bucket, key)
        
        if video_data is None:
            print("Failed to retrieve data from S3")
            return {
                'statusCode': 500,
                'body': json.dumps({
                    'error': 'Failed to retrieve data from S3'
                })
            }
        
        print(f"Retrieved video_data keys: {list(video_data.keys())}")
        
        # 检查是否有metadata，如果没有，尝试从文件名提取视频名称
        if 'metadata' in video_data and 's3_key' in video_data['metadata']:
            s3_key = video_data['metadata']['s3_key']
            video_name = extract_video_name(s3_key)
        else:
            # 如果没有metadata或s3_key，尝试从S3 key提取视频名称
            video_name = extract_video_name(key)
            print(f"Extracted video name from S3 key: {video_name}")
        
        # 生成视频级别的embeddings
        video_summary = ""
        if 'video' in video_data and 'summary' in video_data['video']:
            video_summary = video_data['video']['summary']
        else:
            # 尝试从chapters中获取summary
            for chapter in video_data.get('chapters', []):
                if 'summary' in chapter:
                    video_summary = chapter['summary']
                    break
        
        # 准备章节数据数组
        chapters_data = []
        for chapter in video_data.get('chapters', []):
            chapter_index = chapter.get('chapter_index', 0)
            chapter_summary = chapter.get('summary', '')
            
            # 获取章节的转录文本
            chapter_transcript = chapter.get('transcript', {})
            transcript_text = ""
            
            if isinstance(chapter_transcript, dict):
                if 'representation' in chapter_transcript and 'text' in chapter_transcript['representation']:
                    transcript_text = chapter_transcript['representation']['text']
                elif 'text' in chapter_transcript:
                    transcript_text = chapter_transcript['text']
            else:
                transcript_text = str(chapter_transcript)
            
            print(f"Chapter {chapter_index}: Transcript length: {len(transcript_text)}")
            
            # 将转录文本分割成块
            transcript_chunks = split_transcript_into_chunks(transcript_text)
            print(f"Chapter {chapter_index}: Split transcript into {len(transcript_chunks)} chunks")
            
            # 为每个块生成embeddings
            chunk_data = []
            for i, chunk in enumerate(transcript_chunks):
                chunk_embedding = get_embeddings(chunk)
                chunk_data.append({
                    'chunk_index': i,
                    'text': chunk,
                    'embedding': chunk_embedding
                })
            
            chapter_data = {
                'chapter_index': chapter_index,
                'start_timestamp_millis': chapter.get('start_timestamp_millis'),
                'end_timestamp_millis': chapter.get('end_timestamp_millis'),
                'start_frame_index': chapter.get('start_frame_index'),
                'end_frame_index': chapter.get('end_frame_index'),
                'duration_millis': chapter.get('duration_millis'),
                'chapter_summary': {
                    'text': chapter_summary,
                    'embedding': get_embeddings(chapter_summary)
                },
                'transcript_chunks': chunk_data
            }
            chapters_data.append(chapter_data)
        
        # 准备完整的视频文档数据
        doc_data = {
            'video_name': video_name,
            'video_summary': {
                'text': video_summary,
                'embedding': get_embeddings(video_summary)
            },
            'chapters': chapters_data
        }
        
        # 存储到DocumentDB
        print(f"Storing data for video: {video_name} with {len(chapters_data)} chapters")
        store_in_documentdb(doc_data)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Successfully processed video data and stored embeddings',
                'video_name': video_name,
                'total_chapters': len(chapters_data),
                'total_chunks': sum(len(chapter.get('transcript_chunks', [])) for chapter in chapters_data)
            })
        }
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e)
            })
        }
