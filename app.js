const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const loadingOverlay = document.getElementById('loading-overlay');

// DOM Element targets
const uiLiveAngle = document.getElementById('live-angle');
const uiPeakAngle = document.getElementById('peak-angle');
const uiStatusBadge = document.getElementById('status-badge');
const uiFeedback = document.getElementById('coaching-feedback');

// Application Tracking States
let isThrowing = false;
let peakElbowAngle = 0;

/**
 * Calculates the internal angle at point B (Elbow) relative to A (Shoulder) and C (Wrist)
 */
function calculateAngle(p1, p2, p3) {
    let radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);
    if (angle > 180.0) {
        angle = 360 - angle;
    }
    return Math.round(angle);
}

/**
 * Validates dynamic throw values and handles UI display states
 */
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
 * MediaPipe Frame Execution Callback Loop
 */
function onResults(results) {
    if (loadingOverlay) {
        loadingOverlay.classList.add('opacity-0', 'pointer-events-none');
    }

    if (canvasElement.width !== videoElement.videoWidth) {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
        // Subtle, professional slate-colored lines and emerald joint markers
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#475569', lineWidth: 2});
        drawLandmarks(canvasCtx, results.poseLandmarks, {color: '#10b981', lineWidth: 1, radius: 3});

        // Right side landmarks (Shoulder=12, Elbow=14, Wrist=16)
        const shoulder = results.poseLandmarks[12];
        const elbow = results.poseLandmarks[14];
        const wrist = results.poseLandmarks[16];

        if (shoulder && elbow && wrist) {
            if (shoulder.visibility > 0.5 && elbow.visibility > 0.5 && wrist.visibility > 0.5) {
                const currentAngle = calculateAngle(shoulder, elbow, wrist);
                uiLiveAngle.innerText = `${currentAngle}°`;

                // Throw Tracking Logic: Triggered when hand rises above shoulder height
                if (wrist.y < shoulder.y) {
                    if (!isThrowing) {
                        isThrowing = true;
                        peakElbowAngle = currentAngle; 
                        uiStatusBadge.className = "inline-block px-3 py-1 rounded-full text-xs font-medium bg-emerald-500 animate-pulse text-slate-950";
                        uiStatusBadge.innerText = "Tracking Throw...";
                    } else {
                        if (currentAngle > peakElbowAngle) {
                            peakElbowAngle = currentAngle;
                        }
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

const camera = new Camera(videoElement, {
    onFrame: async () => {
        await pose.send({image: videoElement});
    },
    width: 640,
    height: 480
});

camera.start().catch(err => {
    alert("Camera permission denied or camera device is unavailable.");
    console.error(err);
});
