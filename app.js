const videoElement = document.getElementById('webcam');
const uploadedVideo = document.getElementById('uploaded-video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const loadingOverlay = document.getElementById('loading-overlay');
const cameraSelect = document.getElementById('camera-select');
const zoomSlider = document.getElementById('zoom-control');
const zoomValDisplay = document.getElementById('zoom-value');
const recordingIndicator = document.getElementById('recording-indicator');
const fileUpload = document.getElementById('file-upload');

const btnPitching = document.getElementById('mode-pitching');
const btnBatting = document.getElementById('mode-batting');
const engineModeBadge = document.getElementById('engine-mode-badge');
const btnRecord = document.getElementById('btn-record');
const btnDeepScan = document.getElementById('btn-deep-scan');
const btnSave = document.getElementById('btn-save');

const uiLiveAngle = document.getElementById('live-angle');
const uiPeakAngle = document.getElementById('peak-angle');
const uiStatusBadge = document.getElementById('status-badge');
const uiFeedback = document.getElementById('coaching-feedback');
const standardReportDiv = document.getElementById('standard-report');
const deepReportDiv = document.getElementById('deep-report');

const drFrames = document.getElementById('dr-frames');
const drAvg = document.getElementById('dr-avg');
const drMin = document.getElementById('dr-min');
const drMax = document.getElementById('dr-max');
const drFeedback = document.getElementById('dr-feedback');

// State Engine Properties
let currentMode = "pitching"; 
let zoomScale = 1.0;
let currentFacingMode = "user"; 
let localStream = null;
let activeVideoSource = videoElement; // Dynamic switch source reference

// Recording & Export Arrays
let isRecording = false;
let useDeepScan = false;
let frameData = [];
let mediaRecorder = null;
let recordedChunks = [];

function calculateAngle(p1, p2, p3) {
    let radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return Math.round(angle);
}

function filterFaceConnections(connections) {
    return connections.filter(conn => conn[0] > 10 && conn[1] > 10);
}

// --- EVALUATIONS ---
function evaluateStandard(peakValue) {
    standardReportDiv.classList.remove('hidden');
    deepReportDiv.classList.add('hidden');
    uiPeakAngle.innerText = `${peakValue}°`;
    uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    uiStatusBadge.innerText = "Processing Complete";
    uiFeedback.innerText = `Standard analysis verified a metric threshold boundary value of ${peakValue}°. Target your biomechanical constraints cleanly to preserve join kinematics.`;
}

function evaluateDeepScan(dataArray) {
    standardReportDiv.classList.add('hidden');
    deepReportDiv.classList.remove('hidden');
    const totalFrames = dataArray.length;
    const minAngle = Math.min(...dataArray);
    const maxAngle = Math.max(...dataArray);
    const sum = dataArray.reduce((a, b) => a + b, 0);
    const avgAngle = Math.round(sum / totalFrames) || 0;

    drFrames.innerText = totalFrames;
    drAvg.innerText = `${avgAngle}°`;
    drMin.innerText = `${minAngle}°`;
    drMax.innerText = `${maxAngle}°`;
    drFeedback.innerText = `Deep analysis mapping successfully evaluated ${totalFrames} frames. Variance parameters identified structural movement bounds from a minimum configuration of ${minAngle}° out to a maximum extension path of ${maxAngle}°.`;
}

// --- RENDERING HOOK ---
function onResults(results) {
    if (loadingOverlay) loadingOverlay.classList.add('opacity-0', 'pointer-events-none');

    if (canvasElement.width !== activeVideoSource.videoWidth && activeVideoSource.videoWidth > 0) {
        canvasElement.width = activeVideoSource.videoWidth;
        canvasElement.height = activeVideoSource.videoHeight;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    canvasCtx.translate(canvasElement.width / 2, canvasElement.height / 2);
    canvasCtx.scale(zoomScale, zoomScale);
    // Mirror standard live webcams only, don't mirror static uploaded analytical video file templates
    if (currentFacingMode === "user" && activeVideoSource === videoElement) {
        canvasCtx.scale(-1, 1);
    }
    canvasCtx.translate(-canvasElement.width / 2, -canvasElement.height / 2);
    
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
        const filteredLandmarks = results.poseLandmarks.map((lm, idx) => {
            return idx <= 10 ? { x: 0, y: 0, z: 0, visibility: 0 } : lm;
        });

        drawConnectors(canvasCtx, filteredLandmarks, filterFaceConnections(POSE_CONNECTIONS), {color: '#475569', lineWidth: 3});
        for (let i = 11; i < filteredLandmarks.length; i++) {
            if(filteredLandmarks[i].visibility > 0.5) drawLandmarks(canvasCtx, [filteredLandmarks[i]], {color: '#10b981', lineWidth: 1, radius: 3});
        }

        let currentAngle = 0;
        if (currentMode === "pitching") {
            const shoulder = results.poseLandmarks[12]; const elbow = results.poseLandmarks[14]; const wrist = results.poseLandmarks[16];
            if (shoulder && elbow && wrist && shoulder.visibility > 0.5 && elbow.visibility > 0.5 && wrist.visibility > 0.5) currentAngle = calculateAngle(shoulder, elbow, wrist);
        } else {
            const shoulder = results.poseLandmarks[11]; const elbow = results.poseLandmarks[13]; const wrist = results.poseLandmarks[15];
            if (shoulder && elbow && wrist && shoulder.visibility > 0.5 && elbow.visibility > 0.5 && wrist.visibility > 0.5) currentAngle = calculateAngle(shoulder, elbow, wrist);
        }

        uiLiveAngle.innerText = `${currentAngle}°`;
        if (isRecording && currentAngle > 0) frameData.push(currentAngle);
    }
    canvasCtx.restore();
}

const pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
pose.onResults(onResults);

// --- PIPELINE HANDLERS ---
async function startCameraStream(deviceId) {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    uploadedVideo.pause();
    activeVideoSource = videoElement;
    try {
        const constraints = { video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } } };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoElement.srcObject = localStream;
        videoElement.onloadedmetadata = () => {
            async function process() {
                if (activeVideoSource !== videoElement || !localStream.active) return;
                await pose.send({ image: videoElement });
                requestAnimationFrame(process);
            }
            process();
        };
    } catch (err) { console.error(err); }
}

// Upload File Pipeline Processor
fileUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    activeVideoSource = uploadedVideo;
    uploadedVideo.src = URL.createObjectURL(file);
    
    uploadedVideo.onloadedmetadata = () => {
        uploadedVideo.play();
        async function processUploadedFrame() {
            if (activeVideoSource !== uploadedVideo || uploadedVideo.paused || uploadedVideo.ended) return;
            await pose.send({ image: uploadedVideo });
            requestAnimationFrame(processUploadedFrame);
        }
        processUploadedFrame();
    };
});

// --- RECORD AND SAVE COMPONENT LOOPS ---
function setupRecorder() {
    recordedChunks = [];
    // Capture canvas frame stream at max possible frame rates
    const stream = canvasElement.captureStream(60); 
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
        btnSave.disabled = false; // Enable export capability download button
    };
}

function toggleRecording() {
    if (!isRecording) {
        isRecording = true;
        frameData = [];
        setupRecorder();
        mediaRecorder.start();
        
        recordingIndicator.classList.replace('bg-emerald-500', 'bg-rose-500');
        btnRecord.innerHTML = `<div class="w-3 h-3 bg-white rounded-sm"></div> <span>Stop Processing</span>`;
        btnRecord.classList.add('animate-pulse');
    } else {
        isRecording = false;
        mediaRecorder.stop();
        recordingIndicator.classList.replace('bg-rose-500', 'bg-emerald-500');
        btnRecord.innerHTML = `<div class="w-3 h-3 bg-white rounded-full"></div> <span>Rec Standard</span>`;
        btnRecord.classList.remove('animate-pulse');

        if (frameData.length > 0) {
            if (useDeepScan) evaluateDeepScan(frameData);
            else evaluateStandard(currentMode === "pitching" ? Math.max(...frameData) : Math.min(...frameData));
        }
    }
}

btnSave.addEventListener('click', () => {
    if (recordedChunks.length === 0) return;
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VelocityAI-Telemetry-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});

// --- HARDWARE INITIALIZATION HUB ---
async function loadCameraDevices() {
    try {
        await navigator.mediaDevices.getUserMedia({ video: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        cameraSelect.innerHTML = '';
        videoDevices.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Lens Layout ${index + 1}`;
            cameraSelect.appendChild(option);
        });
        cameraSelect.addEventListener('change', (e) => startCameraStream(e.target.value));
        if (videoDevices.length > 0) startCameraStream(videoDevices[0].deviceId);
    } catch (err) { console.error(err); }
}

btnRecord.addEventListener('click', () => { useDeepScan = false; toggleRecording(); });
btnDeepScan.addEventListener('click', () => { useDeepScan = true; toggleRecording(); });
zoomSlider.addEventListener('input', (e) => { zoomScale = parseFloat(e.target.value); zoomValDisplay.innerText = `${zoomScale.toFixed(1)}x`; });
btnPitching.addEventListener('click', () => { currentMode = "pitching"; engineModeBadge.innerText = "Pitching Mode"; });
btnBatting.addEventListener('click', () => { currentMode = "batting"; engineModeBadge.innerText = "Batting Mode"; });

loadCameraDevices();
