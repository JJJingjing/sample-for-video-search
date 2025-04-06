import json
import boto3
import os
from botocore.exceptions import ClientError
import pymongo
from pymongo import MongoClient
import re
import sys
import socket
import uuid


class VideoDataProcessor:
    def __init__(self):
        # Initialize Bedrock client
        region = os.environ.get('DEPLOY_REGION', 'us-west-2')
        self.bedrock_client = boto3.client('bedrock-runtime', region_name=region)
        # 打印版本信息以便调试
        print(f"Python version: {sys.version}")
        print(f"PyMongo version: {pymongo.__version__}")
        print(f"boto3 version: {boto3.__version__}")

    def test_connection(self):
        try:
            # 从环境变量获取连接信息
            mongodb_uri = os.environ.get('MONGODB_URI')
            
            if not mongodb_uri:
                # 如果没有设置MONGODB_URI，尝试使用其他环境变量
                db_endpoint = os.environ.get('DB_ENDPOINT')
                db_port = os.environ.get('DB_PORT', '27017')
                
                if not db_endpoint:
                    print("Neither MONGODB_URI nor DB_ENDPOINT environment variable is set, skipping connection test")
                    return
                
                host = db_endpoint
                port = int(db_port)
            else:
                # 解析URI以获取主机和端口
                parts = mongodb_uri.split('@')[1].split('/')[0].split(':')
                host = parts[0]
                port = int(parts[1]) if len(parts) > 1 else 27017
            
            # 不打印完整的连接信息，只打印主机和端口
            socket.create_connection((host, port), timeout=60)
            print(f"Successfully connected to {host}:{port}")
        except Exception as e:
            print(f"Connection failed: {e}")
            # 不抛出异常，让函数继续执行

    def get_json_from_s3(self, bucket, key):
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

    def extract_video_name(self, s3_key):
        """从s3_key中提取视频名称（不含扩展名）"""
        # 从路径中获取文件名 (例如从 "video-input/endemo3.mp4" 获取 "endemo3.mp4")
        file_name = s3_key.split('/')[-1]
        # 移除扩展名 (例如从 "endemo3.mp4" 获取 "endemo3")
        video_name = os.path.splitext(file_name)[0]
        return video_name

    def get_embeddings(self, text):
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
            response = self.bedrock_client.invoke_model(
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

    def split_transcript_into_chunks(self, transcript_text, max_chunk_size=500, min_chunk_size=100):
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

    def test_connection(self):
        try:
            # 从环境变量获取连接信息
            mongodb_uri = os.environ.get('MONGODB_URI')
            
            if not mongodb_uri:
                # 如果没有设置MONGODB_URI，尝试使用其他环境变量
                db_endpoint = os.environ.get('DB_ENDPOINT')
                db_port = os.environ.get('DB_PORT', '27017')
                
                if not db_endpoint:
                    print("Neither MONGODB_URI nor DB_ENDPOINT environment variable is set, skipping connection test")
                    return
                
                host = db_endpoint
                port = int(db_port)
            else:
                # 解析URI以获取主机和端口
                parts = mongodb_uri.split('@')[1].split('/')[0].split(':')
                host = parts[0]
                port = int(parts[1]) if len(parts) > 1 else 27017
            
            # 不打印完整的连接信息，只打印主机和端口
            socket.create_connection((host, port), timeout=60)
            print(f"Successfully connected to {host}:{port}")
        except Exception as e:
            print(f"Connection failed: {e}")
            # 不抛出异常，让函数继续执行

    def flatten_video_data(self, video_data, video_name):
        flattened_data = []

        # 处理视频摘要
        video_summary = video_data.get('video_summary', {})
        flattened_summary = {
            "video_name": video_name,
            "source": "video_summary",
            "text": video_summary.get('text', ""),
            "embedding": video_summary.get('embedding', []),
            "start_timestamp_millis": None,
            "end_timestamp_millis": None
        }
        flattened_data.append(flattened_summary)

        # 处理章节
        chapters = video_data.get('chapters', [])
        for chapter in chapters:
            chapter_summary = chapter.get('chapter_summary', {})
            flattened_chapter_summary = {
                "video_name": video_name,
                "source": f"chapter_{chapter.get('chapter_index', 0)}_summary",
                "text": chapter_summary.get('text', ""),
                "embedding": chapter_summary.get('embedding', []),
                "start_timestamp_millis": chapter.get('start_timestamp_millis'),
                "end_timestamp_millis": chapter.get('end_timestamp_millis')
            }
            flattened_data.append(flattened_chapter_summary)

            # 处理章节转录块
            transcript_chunks = chapter.get('transcript_chunks', [])
            for chunk in transcript_chunks:
                flattened_chunk = {
                    "video_name": video_name,
                    "source": f"chapter_{chapter.get('chapter_index', 0)}_transcript_chunk_{chunk.get('chunk_index', 0)}",
                    "text": chunk.get('text', ""),
                    "embedding": chunk.get('embedding', []),
                    "start_timestamp_millis": chapter.get('start_timestamp_millis'),
                    "end_timestamp_millis": chapter.get('end_timestamp_millis')
                }
                flattened_data.append(flattened_chunk)

        return flattened_data

    def store_in_documentdb(self, flattened_data):
        """存储数据到DocumentDB的videodata集合"""
        try:
            # Retrieve MongoDB URI from environment variable
            mongodb_uri = os.environ.get('MONGODB_URI')
            if not mongodb_uri:
                # 如果没有设置MONGODB_URI，尝试使用其他环境变量构建
                db_endpoint = os.environ.get('DB_ENDPOINT')
                db_username = os.environ.get('DB_USERNAME')
                db_password = os.environ.get('DB_PASSWORD')
                db_port = os.environ.get('DB_PORT', '27017')
                
                if db_endpoint:
                    mongodb_uri = f"mongodb://{db_username}:{db_password}@{db_endpoint}:{db_port}/?replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&ssl=false"
                else:
                    raise ValueError("Neither MONGODB_URI nor DB_ENDPOINT environment variable is set")

            # Create a MongoDB client with increased timeout
            client = MongoClient(mongodb_uri, socketTimeoutMS=60000, connectTimeoutMS=60000)

            # Specify the database and collection
            db_name = os.environ.get('DB_NAME', 'VideoData')
            collection_name = os.environ.get('COLLECTION_NAME', 'videodata')
            db = client[db_name]
            collection = db[collection_name]

            # 批量插入数据
            if flattened_data:
                # 为每条数据添加唯一ID并确保embedding是普通Python列表
                for item in flattened_data:
                    item['_id'] = str(uuid.uuid4())
                    
                    # 确保embedding是普通Python列表
                    if 'embedding' in item and hasattr(item['embedding'], 'tolist'):
                        item['embedding'] = item['embedding'].tolist()

                result = collection.insert_many(flattened_data)
                print(f"Successfully stored {len(result.inserted_ids)} flattened documents in DocumentDB.")
            else:
                print("No data to store")

            # Close the connection
            client.close()
        except pymongo.errors.ServerSelectionTimeoutError as timeout_error:
            print(f"Timeout error connecting to DocumentDB: {str(timeout_error)}")
            print(f"Please check your network connection and DocumentDB cluster status.")
            raise
        except Exception as e:
            print(f"Error storing data in DocumentDB: {str(e)}")
            print(f"MongoDB URI (with password redacted): [REDACTED]")
            print(f"Python version: {sys.version}")
            print(f"PyMongo version: {pymongo.__version__}")
            print(f"boto3 version: {boto3.__version__}")
            raise

    def process_video_data(self, event):
        try:
            # Test the connection to DocumentDB
            self.test_connection()

            print(f"Received event: {json.dumps(event)}")
            
            # 从EventBridge事件中获取bucket和key
            if 'detail' in event and 'bucket' in event['detail'] and 'object' in event['detail']:
                bucket = event['detail']['bucket']['name']
                key = event['detail']['object']['key']
            else:
                # 尝试从S3事件中获取
                try:
                    record = event['Records'][0]
                    bucket = record['s3']['bucket']['name']
                    key = record['s3']['object']['key']
                except (KeyError, IndexError):
                    print("Could not extract bucket and key from event")
                    return {
                        'statusCode': 400,
                        'body': json.dumps({
                            'error': 'Invalid event format'
                        })
                    }
            
            print(f"Attempting to read JSON from S3: {bucket}/{key}")
            # 读取JSON文件内容
            video_data = self.get_json_from_s3(bucket, key)
            
            if video_data is None:
                print("Failed to retrieve data from S3")
                return {
                    'statusCode': 500,
                    'body': json.dumps({
                        'error': 'Failed to retrieve data from S3'
                    })
                }
            
            print(f"Retrieved video_data keys: {list(video_data.keys())}")
            
            # 从S3 key提取视频名称
            # 文件路径格式: video_input/Friends.mp4/uuid/0/standard_output/0/result.json
            # 视频名称在第二部分
            parts = key.split('/')
            if len(parts) >= 2:
                video_name = parts[1]  # 第二部分是视频名称
            else:
                # 如果路径格式不符合预期，使用备用方法
                video_name = self.extract_video_name(key)
            
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
                transcript_chunks = self.split_transcript_into_chunks(transcript_text)
                print(f"Chapter {chapter_index}: Split transcript into {len(transcript_chunks)} chunks")

                # 为每个块生成embeddings
                chunk_data = []
                for i, chunk in enumerate(transcript_chunks):
                    chunk_embedding = self.get_embeddings(chunk)
                    # 确保embedding是普通Python列表
                    if hasattr(chunk_embedding, 'tolist'):
                        chunk_embedding = chunk_embedding.tolist()
                    chunk_data.append({
                        'chunk_index': i,
                        'text': chunk,
                        'embedding': chunk_embedding
                    })

                # 获取章节摘要的embedding并确保是普通Python列表
                chapter_summary_embedding = self.get_embeddings(chapter_summary)
                if hasattr(chapter_summary_embedding, 'tolist'):
                    chapter_summary_embedding = chapter_summary_embedding.tolist()

                chapter_data = {
                    'chapter_index': chapter_index,
                    'start_timestamp_millis': chapter.get('start_timestamp_millis'),
                    'end_timestamp_millis': chapter.get('end_timestamp_millis'),
                    'start_frame_index': chapter.get('start_frame_index'),
                    'end_frame_index': chapter.get('end_frame_index'),
                    'duration_millis': chapter.get('duration_millis'),
                    'chapter_summary': {
                        'text': chapter_summary,
                        'embedding': chapter_summary_embedding
                    },
                    'transcript_chunks': chunk_data
                }
                chapters_data.append(chapter_data)

            # 获取视频摘要的embedding并确保是普通Python列表
            video_summary_embedding = self.get_embeddings(video_summary)
            if hasattr(video_summary_embedding, 'tolist'):
                video_summary_embedding = video_summary_embedding.tolist()

            # 准备完整的视频文档数据
            doc_data = {
                'video_name': video_name,
                'video_summary': {
                    'text': video_summary,
                    'embedding': video_summary_embedding
                },
                'chapters': chapters_data
            }

            # 扁平化处理数据
            flattened_data = self.flatten_video_data(doc_data, video_name)

            # 存储到DocumentDB的videodata集合
            self.store_in_documentdb(flattened_data)

            return {
                'statusCode': 200,
                'body': json.dumps({
                    'message': 'Successfully processed video data, flattened it, and stored in DocumentDB',
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


def lambda_handler(event, context):
    processor = VideoDataProcessor()
    return processor.process_video_data(event)
