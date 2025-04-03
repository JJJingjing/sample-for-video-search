<<<<<<< HEAD
// DOM 元素
=======
// DOM elements
>>>>>>> dev
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const resultsContainer = document.getElementById('results');
const loadingElement = document.getElementById('loading');
const modeRadios = document.getElementsByName('search-mode');

<<<<<<< HEAD
// 事件监听器
=======
// Event listeners
>>>>>>> dev
searchButton.addEventListener('click', performSearch);
searchInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        performSearch();
    }
});

<<<<<<< HEAD
// 获取当前选择的搜索模式
=======
// Get the currently selected search mode
>>>>>>> dev
function getSelectedMode() {
    for (const radio of modeRadios) {
        if (radio.checked) {
            return radio.value;
        }
    }
<<<<<<< HEAD
    return 'transcripts'; // 默认模式
}

// 搜索功能
=======
    return 'transcripts'; // Default mode
}

// Search functionality
>>>>>>> dev
async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

<<<<<<< HEAD
    // 获取当前选择的搜索模式
    const mode = getSelectedMode();

    // 显示加载状态
=======
    // Get the currently selected search mode
    const mode = getSelectedMode();

    // Show loading state
>>>>>>> dev
    loadingElement.style.display = 'block';
    resultsContainer.innerHTML = '';

    try {
<<<<<<< HEAD
        console.log(`执行搜索: 查询="${query}", 模式=${mode}`);
=======
        console.log(`Performing search: query="${query}", mode=${mode}`);
>>>>>>> dev
        
        const response = await fetch(`${window.CONFIG.API_ENDPOINT}/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: query,
<<<<<<< HEAD
                mode: mode, // 使用用户选择的模式
=======
                mode: mode, // Use the user-selected mode
>>>>>>> dev
                top_k: 10
            })
        });

        let data = await response.json();
<<<<<<< HEAD
        console.log('原始API响应:', data);
        
        // 处理可能的嵌套响应格式
        let results = [];
        if (data.statusCode === 200 && typeof data.body === 'string') {
            const parsedBody = JSON.parse(data.body);
            console.log('解析的API响应体:', parsedBody);
=======
        console.log('Raw API response:', data);
        
        // Handle possible nested response formats
        let results = [];
        if (data.statusCode === 200 && typeof data.body === 'string') {
            const parsedBody = JSON.parse(data.body);
            console.log('Parsed API response body:', parsedBody);
>>>>>>> dev
            results = parsedBody.frontend_results || [];
        } else if (data.frontend_results) {
            results = data.frontend_results;
        } else if (Array.isArray(data)) {
<<<<<<< HEAD
            // 如果响应直接是一个数组
            results = data;
        } else {
            console.warn('意外的API响应格式:', data);
            // 尝试从响应中提取可能的结果
=======
            // If the response is directly an array
            results = data;
        } else {
            console.warn('Unexpected API response format:', data);
            // Try to extract possible results from the response
>>>>>>> dev
            if (data && typeof data === 'object') {
                const possibleResults = Object.values(data).find(v => Array.isArray(v));
                if (possibleResults) {
                    results = possibleResults;
                }
            }
        }

<<<<<<< HEAD
        console.log('处理后的结果:', results);
        displayResults(results);
    } catch (error) {
        console.error('搜索出错:', error);
        resultsContainer.innerHTML = `<p>搜索时出错: ${error.message}</p>`;
=======
        console.log('Processed results:', results);
        displayResults(results);
    } catch (error) {
        console.error('Search error:', error);
        resultsContainer.innerHTML = `<p>Error during search: ${error.message}</p>`;
>>>>>>> dev
    } finally {
        loadingElement.style.display = 'none';
    }
}

<<<<<<< HEAD
// 显示结果
function displayResults(results) {
    if (!Array.isArray(results) || results.length === 0) {
        resultsContainer.innerHTML = '<p>没有找到匹配的结果</p>';
        return;
    }

    console.log('处理结果:', results);
    resultsContainer.innerHTML = '';
    
    // 按相似度（relevance_score）从高到低排序结果
    results.sort((a, b) => {
        const scoreA = a.relevance_score !== undefined ? a.relevance_score : 0;
        const scoreB = b.relevance_score !== undefined ? b.relevance_score : 0;
        return scoreB - scoreA; // 从高到低排序
    });
    
    // 添加排序后的结果信息
    console.log('排序后的结果:', results.map(r => ({
=======
// Display results
function displayResults(results) {
    if (!Array.isArray(results) || results.length === 0) {
        resultsContainer.innerHTML = '<p>No matching results found</p>';
        return;
    }

    console.log('Processing results:', results);
    resultsContainer.innerHTML = '';
    
    // Sort results by relevance score from high to low
    results.sort((a, b) => {
        const scoreA = a.relevance_score !== undefined ? a.relevance_score : 0;
        const scoreB = b.relevance_score !== undefined ? b.relevance_score : 0;
        return scoreB - scoreA; // Sort from high to low
    });
    
    // Add sorted results info
    console.log('Sorted results:', results.map(r => ({
>>>>>>> dev
        video: r.video_name || r.source,
        score: r.relevance_score,
        timestamp: r.start_timestamp_millis || r.timestamp
    })));
    
    results.forEach(result => {
<<<<<<< HEAD
        if (!result) return; // 跳过无效结果
        
        const videoName = result.video_name || result.source || "未知视频";
        const videoUrl = getVideoUrl(videoName);
        
        // 使用 start_timestamp_millis 作为主要时间戳，如果不存在则尝试使用 timestamp
        const timestamp = result.start_timestamp_millis || result.timestamp || 0;
        const endTimestamp = result.end_timestamp_millis || result.timestamp || timestamp;
        const text = result.text || "无文本描述";
        const score = result.relevance_score !== undefined ? result.relevance_score.toFixed(2) : "N/A";
        
        console.log(`处理视频项: ${videoName}, 开始时间: ${timestamp}, 结束时间: ${endTimestamp}, 相似度: ${score}`);
=======
        if (!result) return; // Skip invalid results
        
        const videoName = result.video_name || result.source || "Unknown Video";
        const videoUrl = getVideoUrl(videoName);
        
        // Use start_timestamp_millis as the primary timestamp, if not available try timestamp
        const timestamp = result.start_timestamp_millis || result.timestamp || 0;
        const endTimestamp = result.end_timestamp_millis || result.timestamp || timestamp;
        const text = result.text || "No text description";
        const score = result.relevance_score !== undefined ? result.relevance_score.toFixed(2) : "N/A";
        
        console.log(`Processing video item: ${videoName}, start time: ${timestamp}, end time: ${endTimestamp}, relevance: ${score}`);
>>>>>>> dev
        
        const card = document.createElement('div');
        card.className = 'video-card';
        
        card.innerHTML = `
            <video controls>
                <source src="${videoUrl}" type="video/mp4">
<<<<<<< HEAD
                您的浏览器不支持视频标签
            </video>
            <div class="video-info">
                <div class="video-title">${videoName}</div>
                <div class="video-timestamp">时间点: ${formatTimestamp(timestamp)} - ${formatTimestamp(endTimestamp)}</div>
                <div class="video-score">相似度: ${score}</div>
=======
                Your browser does not support the video tag
            </video>
            <div class="video-info">
                <div class="video-title">${videoName}</div>
                <div class="video-timestamp">Timestamp: ${formatTimestamp(timestamp)} - ${formatTimestamp(endTimestamp)}</div>
                <div class="video-score">Relevance: ${score}</div>
>>>>>>> dev
                <p>${text}</p>
            </div>
        `;
        
<<<<<<< HEAD
        // 设置视频开始时间
        const video = card.querySelector('video');
        video.addEventListener('loadedmetadata', function() {
            // 确保时间戳是有效的数字，并转换为秒
            if (timestamp !== undefined && timestamp !== null && !isNaN(timestamp)) {
                const seconds = timestamp / 1000;
                if (isFinite(seconds) && seconds >= 0) {
                    console.log(`设置视频 ${videoName} 的开始时间为 ${seconds} 秒`);
=======
        // Set video start time
        const video = card.querySelector('video');
        video.addEventListener('loadedmetadata', function() {
            // Ensure timestamp is a valid number and convert to seconds
            if (timestamp !== undefined && timestamp !== null && !isNaN(timestamp)) {
                const seconds = timestamp / 1000;
                if (isFinite(seconds) && seconds >= 0) {
                    console.log(`Setting video ${videoName} start time to ${seconds} seconds`);
>>>>>>> dev
                    video.currentTime = seconds;
                }
            }
        });
        
        resultsContainer.appendChild(card);
    });
}

<<<<<<< HEAD
// 获取视频URL
function getVideoUrl(videoName) {
    // 如果视频名称是source字段（如chapter_8_summary），尝试提取视频名称
    if (videoName.includes('chapter_') || videoName.includes('summary')) {
        // 尝试从source中提取视频名称，例如从"chapter_8_summary"提取"chapter_8"
=======
// Get video URL
function getVideoUrl(videoName) {
    // If video name is a source field (like chapter_8_summary), try to extract the video name
    if (videoName.includes('chapter_') || videoName.includes('summary')) {
        // Try to extract video name from source, e.g., extract "chapter_8" from "chapter_8_summary"
>>>>>>> dev
        const match = videoName.match(/(chapter_\d+)/);
        if (match) {
            videoName = match[1];
        }
    }

<<<<<<< HEAD
    // 如果视频名称已经包含扩展名，直接返回完整URL
=======
    // If video name already includes extension, return the full URL
>>>>>>> dev
    if (videoName.endsWith('.mp4') || videoName.endsWith('.mov')) {
        return `${window.CONFIG.VIDEO_BASE_URL}/${videoName}`;
    }

<<<<<<< HEAD
    // 如果视频名称包含"mov"，则使用.mov扩展名
=======
    // If video name includes "mov", use .mov extension
>>>>>>> dev
    if (videoName.toLowerCase().includes('mov')) {
        return `${window.CONFIG.VIDEO_BASE_URL}/${videoName}.mov`;
    }

<<<<<<< HEAD
    // 默认返回.mp4格式
    return `${window.CONFIG.VIDEO_BASE_URL}/${videoName}.mp4`;
}

// 格式化时间戳
function formatTimestamp(milliseconds) {
    // 确保毫秒数是有效的数字
=======
    // Default to .mp4 format
    return `${window.CONFIG.VIDEO_BASE_URL}/${videoName}.mp4`;
}

// Format timestamp
function formatTimestamp(milliseconds) {
    // Ensure milliseconds is a valid number
>>>>>>> dev
    if (milliseconds === undefined || milliseconds === null || isNaN(milliseconds)) {
        return "00:00";
    }
    
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

<<<<<<< HEAD
// 检查配置并显示警告
=======
// Check configuration and display warnings
>>>>>>> dev
document.addEventListener('DOMContentLoaded', function() {
    console.log('Current configuration:', window.CONFIG);
    
    if (!window.CONFIG || !window.CONFIG.API_ENDPOINT || window.CONFIG.API_ENDPOINT.includes('${API_ENDPOINT}')) {
<<<<<<< HEAD
        console.warn('API_ENDPOINT 未配置，应用可能无法正常工作');
    }
    
    if (!window.CONFIG || !window.CONFIG.CLOUDFRONT_URL || window.CONFIG.CLOUDFRONT_URL.includes('${CLOUDFRONT_URL}')) {
        console.warn('CLOUDFRONT_URL 未配置，应用可能无法正常工作');
=======
        console.warn('API_ENDPOINT is not configured, application may not work properly');
    }
    
    if (!window.CONFIG || !window.CONFIG.CLOUDFRONT_URL || window.CONFIG.CLOUDFRONT_URL.includes('${CLOUDFRONT_URL}')) {
        console.warn('CLOUDFRONT_URL is not configured, application may not work properly');
>>>>>>> dev
    }
});
