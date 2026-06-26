const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const loadingOverlay = document.getElementById('loading-overlay');
const switchCamBtn = document.getElementById('switch-camera');
const zoomSlider = document.getElementById('zoom-control');
const zoomValDisplay = document.getElementById('zoom-value');

// Mode Switch Targets
const btnPitching = document.getElementById('mode-pitching');
const btnBatting = document.getElementById('mode-batting');
const engineModeBadge = document.getElementById('engine-mode-badge');
const telemetryLiveLabel = document.getElementById('telemetry-live-label');
const telemetryPeakLabel = document.getElementById('telemetry-peak-label');

const uiLiveAngle = document.getElementById('live-angle');
const uiPeakAngle = document.getElementById('peak-angle');
const uiStatusBadge = document.getElementById('status-badge');
const uiFeedback = document.getElementById('coaching-feedback');

// State Monitoring Variables
let currentMode = "pitching"; // "pitching" or "batting"
let zoomScale = 1.0;
let isActionActive = false; // Tracks throwing or swinging active states
let peakMetricValue = 0; // Stores peak angle for pitching or peak extension/drop height for batting
let currentFacingMode = "user"; 
let localStream = null;

function calculateAngle(p1, p2, p3) {
    let radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return Math.round(angle);
}

/**
 * Diagnostic logic for pitching form
 */
function evaluatePitch(maxAngle) {
    uiPeakAngle.innerText = `${maxAngle}°`;
    if (maxAngle >= 80 && maxAngle <= 110) {
        uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400";
        uiStatusBadge.innerText = "Excellent Form";
        uiFeedback.innerText = `Elite level positioning (${maxAngle}°). Your arm maintained optimal compression for maximum whip velocity and load safety.`;
    } else if (maxAngle > 110) {
        uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400";
        uiStatusBadge.innerText = "Arm Too Straight";
        uiFeedback.innerText = `Elbow hit over-extension during pull-back phase at ${maxAngle}°. Tighten your angle closer to 90° to improve kinetic transfer efficiency.`;
    } else {
        uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-blue-500/10 border border-blue-500/30 text-blue-400";
        uiStatusBadge.innerText = "Arm Too Tight";
        uiFeedback.innerText = `Elbow movement was restricted at ${maxAngle}°. Extend your arm slightly more outward during load phase to create a larger lever path.`;
    }
}

/**
 * Diagnostic logic for hitting mechanics (Batting Mode)
 */
function evaluateSwing(minSwingAngle) {
    uiPeakAngle.innerText = `${minSwingAngle}°`;
    if (minSwingAngle >= 95 && minSwingAngle <= 125) {
        uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400";
        uiStatusBadge.innerText = "Powerful Extension";
        uiFeedback.innerText = `Solid contact path structure (${minSwingAngle}°). Lead elbow created clean barrel clearance without dropping underneath the ball flight plane.`;
    } else if (minSwingAngle < 95) {
        uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400";
        uiStatusBadge.innerText = "Casting / Dropped Elbow";
        uiFeedback.innerText = `Elbow angle compressed tightly to ${minSwingAngle}° during contact zone sequence. Extend your hands away from your chest earlier to avoid pushing or casting the bat.`;
    } else {
        uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-blue-500/10 border border-blue-500/30 text-blue-400";
        uiStatusBadge.innerText = "Over-extended Swing";
        uiFeedback.innerText = `Arm was too rigid (${minSwingAngle}°). Keep a slight flex in your leading elbow during initialization to pull inside the baseball effectively.`;
    }
}

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
    
    // --- ZOOM LOGIC & MIRROR MATRIX TRANSFORMS ---
    // Move to center, apply scale factor, move back to translate frame origins around the middle point
    canvasCtx.translate(canvasElement.width / 2, canvasElement.height / 2);
    canvasCtx.scale(zoomScale, zoomScale);
    if (currentFacingMode === "user") {
        canvasCtx.scale(-1, 1);
    }
    canvasCtx.translate(-canvasElement.width / 2, -canvasElement.height / 2);
    
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
        const filteredLandmarks = results.poseLandmarks.map((lm, idx) => {
            return idx <= 10 ? { x: 0, y: 0, z: 0, visibility: 0 } : lm;
        });

        const bodyConnections = filterFaceConnections(POSE_CONNECTIONS);
        drawConnectors(canvasCtx, filteredLandmarks, bodyConnections, {color: '#475569', lineWidth: 3});
        
        for (let i = 11; i < filteredLandmarks.length; i++) {
            if(filteredLandmarks[i].visibility > 0.5) {
                drawLandmarks(canvasCtx, [filteredLandmarks[i]], {color: '#10b981', lineWidth: 1, radius: 3});
            }
        }

        // Target processing pipelines depending on global state mode
        if (currentMode === "pitching") {
            // Pitching tracking: Right Side (Shoulder=12, Elbow=14, Wrist=16)
            const shoulder = results.poseLandmarks[12];
            const elbow = results.poseLandmarks[14];
            const wrist = results.poseLandmarks[16];

            if (shoulder && elbow && wrist && shoulder.visibility > 0.5 && elbow.visibility > 0.5 && wrist.visibility > 0.5) {
                const currentAngle = calculateAngle(shoulder, elbow, wrist);
                uiLiveAngle.innerText = `${currentAngle}°`;

                if (wrist.y < shoulder.y) {
                    if (!isActionActive) {
                        isActionActive = true;
                        peakMetricValue = currentAngle; 
                        uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-emerald-500 animate-pulse text-slate-950";
                        uiStatusBadge.innerText = "Tracking Pitch...";
                    } else {
                        if (currentAngle > peakMetricValue) peakMetricValue = currentAngle;
                    }
                } else {
                    if (isActionActive) {
                        evaluatePitch(peakMetricValue);
                        isActionActive = false;
                    }
                }
            }
        } else if (currentMode === "batting") {
            // Batting Tracking: Left leading arm metrics (Shoulder=11, Elbow=13, Wrist=15, Hip=23)
            const shoulder = results.poseLandmarks[11];
            const elbow = results.poseLandmarks[13];
            const wrist = results.poseLandmarks[15];
            const hip = results.poseLandmarks[23];

            if (shoulder && elbow && wrist && hip && shoulder.visibility > 0.5 && elbow.visibility > 0.5 && wrist.visibility > 0.5) {
                const swingAngle = calculateAngle(shoulder, elbow, wrist);
                uiLiveAngle.innerText = `${swingAngle}°`;

                // Trigger Swing Tracking when hands cross inside front hip bounds horizontally
                if (wrist.x < hip.x) {
                    if (!isActionActive) {
                        isActionActive = true;
                        peakMetricValue = swingAngle; // Capture minimum/maximum extension compression window
                        uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-cyan-500 animate-pulse text-slate-950";
                        uiStatusBadge.innerText = "Tracking Swing...";
                    } else {
                        // We track the lowest point of elbow collapse or minimum angle during turning launch
                        if (swingAngle < peakMetricValue) peakMetricValue = swingAngle;
                    }
                } else {
                    if (isActionActive) {
                        evaluateSwing(peakMetricValue);
                        isActionActive = false;
                    }
                }
            }
        }
    }
    canvasCtx.restore();
}

const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
});

pose.onResults(onResults);

async function startCameraStream(facingMode) {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    try {
        currentFacingMode = facingMode;
        const constraints = {
            video: { facingMode: facingMode, width: { ideal: 640 }, height: { ideal: 480 } }
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
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
        alert("Unable to open camera feed source.");
    }
}

// Zoom control change listener
zoomSlider.addEventListener('input', (e) => {
    zoomScale = parseFloat(e.target.value);
    zoomValDisplay.innerText = `${zoomScale.toFixed(1)}x`;
});

// Mode Switching Interface Configuration Event Hooks
btnPitching.addEventListener('click', () => {
    currentMode = "pitching";
    isActionActive = false;
    engineModeBadge.innerText = "Pitching Mode";
    telemetryLiveLabel.innerText = "Live Flexion";
    telemetryPeakLabel.innerText = "Peak Flexion";
    
    btnPitching.className = "flex-1 bg-emerald-500 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs uppercase tracking-wider transition duration-200 shadow-md";
    btnBatting.className = "flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 px-4 rounded-xl text-xs uppercase tracking-wider transition duration-200";
    
    uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300";
    uiStatusBadge.innerText = "Awaiting Movement";
    uiFeedback.innerText = "Step back into view. Raise your hand above shoulder height to trigger pitching mechanics.";
});

btnBatting.addEventListener('click', () => {
    currentMode = "batting";
    isActionActive = false;
    engineModeBadge.innerText = "Batting Mode";
    telemetryLiveLabel.innerText = "Swing Path";
    telemetryPeakLabel.innerText = "Impact Angle";
    
    btnBatting.className = "flex-1 bg-emerald-500 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs uppercase tracking-wider transition duration-200 shadow-md";
    btnPitching.className = "flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 px-4 rounded-xl text-xs uppercase tracking-wider transition duration-200";
    
    uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300";
    uiStatusBadge.innerText = "Awaiting Swing";
    uiFeedback.innerText = "Stand sideways in your batting stance. Swing your arms across your torso frame to evaluate entry extensions.";
});

switchCamBtn.addEventListener('click', () => {
    let targetMode = currentFacingMode === "user" ? "environment" : "user";
    startCameraStream(targetMode);
});

startCameraStream("user");
