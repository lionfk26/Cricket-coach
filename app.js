const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const loadingOverlay = document.getElementById('loading-overlay');
const switchCamBtn = document.getElementById('switch-camera');

const uiLiveAngle = document.getElementById('live-angle');
const uiPeakAngle = document.getElementById('peak-angle');
const uiStatusBadge = document.getElementById('status-badge');
const uiFeedback = document.getElementById('coaching-feedback');

let isThrowing = false;
let peakElbowAngle = 0;
let currentFacingMode = "user"; // "user" for front-facing, "environment" for back-facing
let localStream = null;

function calculateAngle(p1, p2, p3) {
    let radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return Math.round(angle);
}

function evaluateThrow(maxAngle) {
    uiPeakAngle.innerText = `${maxAngle}°`;
    if (maxAngle >= 80 && maxAngle <= 110) {
        uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400";
        uiStatusBadge.innerText = "Excellent Form";
        uiFeedback.innerText = `Elite level positioning (${maxAngle}°). Your arm maintained optimal compression for maximum whip velocity and load safety.`;
    } else if (maxAngle > 110) {
        uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400";
        uiStatusBadge.innerText = "Arm Too Straight";
        uiFeedback.innerText = `Elbow hit over-extension during pull-back phase at ${maxAngle}°. Tighten your angle closer to 90° to improve kinetic transfer efficiency and protect your shoulder joint.`;
    } else {
        uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-blue-500/10 border border-blue-500/30 text-blue-400";
        uiStatusBadge.innerText = "Arm Too Tight";
        uiFeedback.innerText = `Elbow movement was restricted at ${maxAngle}°. Extend your arm slightly more outward during load phase to establish a larger lever path for velocity production.`;
    }
}

/**
 * Filter out connection lines attached to facial coordinates (0 to 10)
 */
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
    
    // Toggle Horizontal Mirror effect based on active camera choice orientation
    if (currentFacingMode === "user") {
        canvasCtx.translate(canvasElement.width, 0);
        canvasCtx.scale(-1, 1);
    }
    
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
        // Create filtered versions that leave out all face landmarks (index 0 - 10)
        const filteredLandmarks = results.poseLandmarks.map((lm, idx) => {
            return idx <= 10 ? { x: 0, y: 0, z: 0, visibility: 0 } : lm;
        });

        const bodyConnections = filterFaceConnections(POSE_CONNECTIONS);

        // Draw body segments cleanly
        drawConnectors(canvasCtx, filteredLandmarks, bodyConnections, {color: '#475569', lineWidth: 3});
        
        // Draw individual tracking nodes
        for (let i = 11; i < filteredLandmarks.length; i++) {
            if(filteredLandmarks[i].visibility > 0.5) {
                drawLandmarks(canvasCtx, [filteredLandmarks[i]], {color: '#10b981', lineWidth: 1, radius: 3});
            }
        }

        const shoulder = results.poseLandmarks[12];
        const elbow = results.poseLandmarks[14];
        const wrist = results.poseLandmarks[16];

        if (shoulder && elbow && wrist) {
            if (shoulder.visibility > 0.5 && elbow.visibility > 0.5 && wrist.visibility > 0.5) {
                const currentAngle = calculateAngle(shoulder, elbow, wrist);
                uiLiveAngle.innerText = `${currentAngle}°`;

                if (wrist.y < shoulder.y) {
                    if (!isThrowing) {
                        isThrowing = true;
                        peakElbowAngle = currentAngle; 
                        uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-emerald-500 animate-pulse text-slate-950";
                        uiStatusBadge.innerText = "Tracking Throw...";
                    } else {
                        if (currentAngle > peakElbowAngle) peakElbowAngle = currentAngle;
                    }
                } else {
                    if (isThrowing) {
                        evaluateThrow(peakElbowAngle);
                        isThrowing = false;
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

/**
 * Handles initialization and device swapping safely using native web stream interfaces
 */
async function startCameraStream(facingMode) {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    try {
        currentFacingMode = facingMode;
        const constraints = {
            video: {
                facingMode: facingMode,
                width: { ideal: 640 },
                height: { ideal: 480 }
            }
        };

        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoElement.srcObject = localStream;
        
        // Feed frames to MediaPipe process manually loop
        videoElement.onloadedmetadata = () => {
            async function processFrame() {
                if (!localStream.active) return;
                await pose.send({ image: videoElement });
                requestAnimationFrame(processFrame);
            }
            processFrame();
        };

    } catch (err) {
        console.error("Camera deployment error:", err);
        alert("Unable to open camera feed source.");
    }
}

// Click Trigger Event Link for Lens Swapping
switchCamBtn.addEventListener('click', () => {
    let targetMode = currentFacingMode === "user" ? "environment" : "user";
    startCameraStream(targetMode);
});

// Kickoff initial frame engine bootup
startCameraStream("user");
