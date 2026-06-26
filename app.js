const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const loadingOverlay = document.getElementById('loading-overlay');
const switchCamBtn = document.getElementById('switch-camera');
const zoomSlider = document.getElementById('zoom-control');
const zoomValDisplay = document.getElementById('zoom-value');
const recordingIndicator = document.getElementById('recording-indicator');

// Setup Targets
const btnPitching = document.getElementById('mode-pitching');
const btnBatting = document.getElementById('mode-batting');
const engineModeBadge = document.getElementById('engine-mode-badge');
const btnRecord = document.getElementById('btn-record');
const btnDeepScan = document.getElementById('btn-deep-scan');

// UI Targets
const uiLiveAngle = document.getElementById('live-angle');
const uiPeakAngle = document.getElementById('peak-angle');
const uiStatusBadge = document.getElementById('status-badge');
const uiFeedback = document.getElementById('coaching-feedback');
const standardReportDiv = document.getElementById('standard-report');
const deepReportDiv = document.getElementById('deep-report');

// Deep Scan Targets
const drFrames = document.getElementById('dr-frames');
const drAvg = document.getElementById('dr-avg');
const drMin = document.getElementById('dr-min');
const drMax = document.getElementById('dr-max');
const drFeedback = document.getElementById('dr-feedback');

// State Engine
let currentMode = "pitching"; 
let zoomScale = 1.0;
let currentFacingMode = "user"; 
let localStream = null;

// Recording State
let isRecording = false;
let useDeepScan = false;
let frameData = [];

function calculateAngle(p1, p2, p3) {
    let radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return Math.round(angle);
}

// --- EVALUATION LOGIC ---

function evaluateStandard(peakValue) {
    standardReportDiv.classList.remove('hidden');
    deepReportDiv.classList.add('hidden');
    uiPeakAngle.innerText = `${peakValue}°`;

    if (currentMode === "pitching") {
        if (peakValue >= 80 && peakValue <= 110) {
            uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400";
            uiStatusBadge.innerText = "Excellent Form";
            uiFeedback.innerText = `Elite level positioning (${peakValue}°). Your arm maintained optimal compression for maximum whip velocity.`;
        } else if (peakValue > 110) {
            uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400";
            uiStatusBadge.innerText = "Arm Too Straight";
            uiFeedback.innerText = `Elbow over-extension hit ${peakValue}°. Tighten your angle closer to 90°.`;
        } else {
            uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-blue-500/10 border border-blue-500/30 text-blue-400";
            uiStatusBadge.innerText = "Arm Too Tight";
            uiFeedback.innerText = `Elbow movement was restricted at ${peakValue}°. Extend your arm outward during load phase.`;
        }
    } else {
        if (peakValue >= 95 && peakValue <= 125) {
            uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400";
            uiStatusBadge.innerText = "Powerful Extension";
            uiFeedback.innerText = `Solid contact path structure (${peakValue}°). Clean barrel clearance.`;
        } else if (peakValue < 95) {
            uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400";
            uiStatusBadge.innerText = "Casting / Dropped Elbow";
            uiFeedback.innerText = `Elbow angle compressed tightly to ${peakValue}°. Extend your hands away from your chest earlier.`;
        } else {
            uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-blue-500/10 border border-blue-500/30 text-blue-400";
            uiStatusBadge.innerText = "Over-extended Swing";
            uiFeedback.innerText = `Arm was too rigid (${peakValue}°). Keep a slight flex in your leading elbow.`;
        }
    }
}

function evaluateDeepScan(dataArray) {
    standardReportDiv.classList.add('hidden');
    deepReportDiv.classList.remove('hidden');

    const totalFrames = dataArray.length;
    const minAngle = Math.min(...dataArray);
    const maxAngle = Math.max(...dataArray);
    const sum = dataArray.reduce((a, b) => a + b, 0);
    const avgAngle = Math.round(sum / totalFrames) || 0;
    const variance = maxAngle - minAngle;

    drFrames.innerText = totalFrames;
    drAvg.innerText = `${avgAngle}°`;
    drMin.innerText = `${minAngle}°`;
    drMax.innerText = `${maxAngle}°`;

    if (currentMode === "pitching") {
        uiPeakAngle.innerText = `${maxAngle}°`;
        drFeedback.innerText = `Over ${totalFrames} frames, your arm fluctuated by ${variance}°. Your peak load hit ${maxAngle}°, and your minimum follow-through release compressed to ${minAngle}°. ` + 
        (maxAngle <= 110 && maxAngle >= 80 ? "Your peak load remains highly efficient and safe." : "Your peak load is currently outside the safe velocity bounds (80°-110°).");
    } else {
        uiPeakAngle.innerText = `${minAngle}°`;
        drFeedback.innerText = `During this swing sequence of ${totalFrames} frames, your lead arm shifted ${variance}°. Your tightest impact compression was ${minAngle}°, capping out at ${maxAngle}° on follow-through. ` + 
        (minAngle >= 95 ? "Excellent barrel preservation through the zone." : "You are collapsing your elbow too tightly against your body through the zone.");
    }
}

// --- MEDIAPIPE LOOP ---

function filterFaceConnections(connections) {
    return connections.filter(conn => conn[0] > 10 && conn[1] > 10);
}

function onResults(results) {
    if (loadingOverlay) loadingOverlay.classList.add('opacity-0', 'pointer-events-none');

    if (canvasElement.width !== videoElement.videoWidth) {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    canvasCtx.translate(canvasElement.width / 2, canvasElement.height / 2);
    canvasCtx.scale(zoomScale, zoomScale);
    if (currentFacingMode === "user") canvasCtx.scale(-1, 1);
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
            const shoulder = results.poseLandmarks[12];
            const elbow = results.poseLandmarks[14];
            const wrist = results.poseLandmarks[16];
            if (shoulder && elbow && wrist && shoulder.visibility > 0.5 && elbow.visibility > 0.5 && wrist.visibility > 0.5) {
                currentAngle = calculateAngle(shoulder, elbow, wrist);
            }
        } else if (currentMode === "batting") {
            const shoulder = results.poseLandmarks[11];
            const elbow = results.poseLandmarks[13];
            const wrist = results.poseLandmarks[15];
            if (shoulder && elbow && wrist && shoulder.visibility > 0.5 && elbow.visibility > 0.5 && wrist.visibility > 0.5) {
                currentAngle = calculateAngle(shoulder, elbow, wrist);
            }
        }

        uiLiveAngle.innerText = `${currentAngle}°`;

        // If manual recording is active, stockpile the data array
        if (isRecording && currentAngle > 0) {
            frameData.push(currentAngle);
        }
    }
    canvasCtx.restore();
}

const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});
pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
pose.onResults(onResults);

async function startCameraStream(facingMode) {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    try {
        currentFacingMode = facingMode;
        localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode, width: { ideal: 640 }, height: { ideal: 480 } } });
        videoElement.srcObject = localStream;
        videoElement.onloadedmetadata = () => {
            async function processFrame() {
                if (!localStream.active) return;
                await pose.send({ image: videoElement });
                requestAnimationFrame(processFrame);
            }
            processFrame();
        };
    } catch (err) {
        alert("Unable to open camera feed.");
    }
}

// --- INTERACTIVE CONTROLS ---

function toggleRecording() {
    if (!isRecording) {
        // Start Recording
        isRecording = true;
        frameData = []; // clear old data
        recordingIndicator.classList.replace('bg-emerald-500', 'bg-rose-500');
        
        btnRecord.innerHTML = `<div class="w-3 h-3 bg-white rounded-sm"></div> <span>Stop Recording</span>`;
        btnRecord.classList.add('animate-pulse');
        
        // Disable Deep Scan toggle during recording
        btnDeepScan.disabled = true;
    } else {
        // Stop Recording & Evaluate
        isRecording = false;
        recordingIndicator.classList.replace('bg-rose-500', 'bg-emerald-500');
        
        btnRecord.innerHTML = `<div class="w-3 h-3 bg-white rounded-full"></div> <span>Rec Standard</span>`;
        btnRecord.classList.remove('animate-pulse');
        btnDeepScan.disabled = false;

        if (frameData.length > 0) {
            if (useDeepScan) {
                evaluateDeepScan(frameData);
            } else {
                let peak = currentMode === "pitching" ? Math.max(...frameData) : Math.min(...frameData);
                evaluateStandard(peak);
            }
        } else {
            uiFeedback.innerText = "No movement data captured. Please ensure you are in frame.";
        }
    }
}

btnRecord.addEventListener('click', () => {
    useDeepScan = false;
    toggleRecording();
});

btnDeepScan.addEventListener('click', () => {
    useDeepScan = true;
    toggleRecording();
    // Update button visually while deep scanning
    if(isRecording) {
        btnRecord.innerHTML = `<div class="w-3 h-3 bg-white rounded-sm"></div> <span>Stop Deep Scan</span>`;
    }
});

btnPitching.addEventListener('click', () => {
    currentMode = "pitching";
    engineModeBadge.innerText = "Pitching Mode";
    btnPitching.className = "flex-1 bg-emerald-500 text-slate-950 font-bold py-2 px-4 rounded-xl text-xs uppercase tracking-wider transition duration-200 shadow-md";
    btnBatting.className = "flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 px-4 rounded-xl text-xs uppercase tracking-wider transition duration-200";
});

btnBatting.addEventListener('click', () => {
    currentMode = "batting";
    engineModeBadge.innerText = "Batting Mode";
    btnBatting.className = "flex-1 bg-emerald-500 text-slate-950 font-bold py-2 px-4 rounded-xl text-xs uppercase tracking-wider transition duration-200 shadow-md";
    btnPitching.className = "flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 px-4 rounded-xl text-xs uppercase tracking-wider transition duration-200";
});

zoomSlider.addEventListener('input', (e) => {
    zoomScale = parseFloat(e.target.value);
    zoomValDisplay.innerText = `${zoomScale.toFixed(1)}x`;
});

switchCamBtn.addEventListener('click', () => {
    startCameraStream(currentFacingMode === "user" ? "environment" : "user");
});

startCameraStream("user");
