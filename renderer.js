const { ipcRenderer } = require('electron');

let detector;
let video;
let lastHandNearHead = false;
let handNearHeadCount = 0;
const FRAMES_THRESHOLD = 30; // Reduced from 100 to 30 frames

async function setupCamera() {
  video = document.getElementById('webcam');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: 640,
      height: 480,
    },
  });
  video.srcObject = stream;

  // Create canvas overlay for visualization
  const canvas = document.createElement('canvas');
  canvas.id = 'overlay';
  canvas.width = 640;
  canvas.height = 480;
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  document.getElementById('videoContainer').appendChild(canvas);

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve(video);
    };
  });
}

async function initializeDetector() {
  try {
    // Initialize TensorFlow.js backend
    await tf.ready();
    console.log('TensorFlow.js version:', tf.version);
    console.log('Backend:', tf.getBackend());

    // Force WebGL backend initialization
    if (tf.getBackend() !== 'webgl') {
      console.log('Setting backend to WebGL');
      await tf.setBackend('webgl');
    }

    // Wait for video to be ready
    while (!video.videoWidth || !video.videoHeight) {
      console.log('Waiting for video dimensions...');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.log('Video dimensions:', video.videoWidth, 'x', video.videoHeight);

    // Initialize MoveNet
    console.log('Initializing MoveNet...');
    const modelConfig = {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      enableSmoothing: true,
    };

    console.log('Creating detector with config:', modelConfig);
    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      modelConfig,
    );
    console.log('Pose detector initialized successfully');
  } catch (error) {
    console.error('Error initializing pose detector:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

function drawKeypoints(keypoints) {
  const canvas = document.getElementById('overlay');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Mirror coordinates for visualization
  function mirrorX(x) {
    return canvas.width - x;
  }

  // Draw all keypoints
  keypoints.forEach((keypoint) => {
    if (keypoint.score && keypoint.score > 0.2) {
      const x = mirrorX(keypoint.x); // Mirror the x coordinate
      ctx.beginPath();
      ctx.arc(x, keypoint.y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = keypoint.name.includes('wrist')
        ? 'red'
        : keypoint.name === 'nose'
        ? 'green'
        : 'blue';
      ctx.fill();
      ctx.fillStyle = 'white';
      ctx.fillText(keypoint.name, x + 5, keypoint.y - 5);
    }
  });
}

function isHandNearHead(keypoints) {
  const canvas = document.getElementById('overlay');
  function mirrorX(x) {
    return canvas.width - x;
  }

  // Find relevant keypoints with lower confidence threshold
  const nose = keypoints.find((kp) => kp.name === 'nose' && kp.score > 0.2);
  const leftEye = keypoints.find(
    (kp) => kp.name === 'left_eye' && kp.score > 0.2,
  );
  const rightEye = keypoints.find(
    (kp) => kp.name === 'right_eye' && kp.score > 0.2,
  );
  const leftWrist = keypoints.find(
    (kp) => kp.name === 'left_wrist' && kp.score > 0.2,
  );
  const rightWrist = keypoints.find(
    (kp) => kp.name === 'right_wrist' && kp.score > 0.2,
  );

  // Only require nose and at least one eye for head position
  if (!nose || (!leftEye && !rightEye) || (!leftWrist && !rightWrist)) {
    return false;
  }

  // Calculate eye center and level using available eye(s) with mirrored coordinates
  const eyeCenterX =
    leftEye && rightEye
      ? (mirrorX(leftEye.x) + mirrorX(rightEye.x)) / 2
      : leftEye
      ? mirrorX(leftEye.x)
      : mirrorX(rightEye.x);
  const eyeCenterY =
    leftEye && rightEye
      ? (leftEye.y + rightEye.y) / 2
      : leftEye
      ? leftEye.y
      : rightEye.y;
  const eyeDistance =
    leftEye && rightEye ? Math.abs(leftEye.x - rightEye.x) : 100;

  // Define larger detection area
  const areaTop = eyeCenterY - eyeDistance * 3;
  const areaBottom = eyeCenterY + eyeDistance;
  const areaLeft = eyeCenterX - eyeDistance * 3;
  const areaRight = eyeCenterX + eyeDistance * 3;

  function isInTargetArea(wrist) {
    if (!wrist) return false;

    const mirroredX = mirrorX(wrist.x);

    // Check if hand is in the target area
    const isInArea =
      mirroredX >= areaLeft &&
      mirroredX <= areaRight &&
      wrist.y >= areaTop &&
      wrist.y <= areaBottom;

    // Calculate distance to eye center
    const distanceToEyes = calculateDistance(
      { x: eyeCenterX, y: eyeCenterY },
      { x: mirroredX, y: wrist.y },
    );

    // More lenient distance threshold
    const isCloseEnough = distanceToEyes < eyeDistance * 4;

    return isInArea && isCloseEnough;
  }

  const leftHandInArea = isInTargetArea(leftWrist);
  const rightHandInArea = isInTargetArea(rightWrist);

  // Draw visualization
  const ctx = canvas.getContext('2d');

  // Draw detection area
  ctx.beginPath();
  ctx.rect(areaLeft, areaTop, areaRight - areaLeft, areaBottom - areaTop);
  ctx.strokeStyle =
    (leftHandInArea || rightHandInArea) && !(leftHandInArea && rightHandInArea)
      ? 'rgba(255, 0, 0, 0.3)'
      : 'rgba(255, 255, 255, 0.3)';
  ctx.stroke();

  // Draw eye center point
  ctx.beginPath();
  ctx.arc(eyeCenterX, eyeCenterY, 3, 0, 2 * Math.PI);
  ctx.fillStyle = 'yellow';
  ctx.fill();

  // Draw distance circles
  ctx.beginPath();
  ctx.arc(eyeCenterX, eyeCenterY, eyeDistance * 4, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(255, 255, 0, 0.2)';
  ctx.stroke();

  // Draw lines to hands with distances
  if (leftWrist) {
    const mirroredLeftX = mirrorX(leftWrist.x);
    ctx.beginPath();
    ctx.moveTo(eyeCenterX, eyeCenterY);
    ctx.lineTo(mirroredLeftX, leftWrist.y);
    ctx.strokeStyle = leftHandInArea && !rightHandInArea ? 'red' : 'green';
    ctx.lineWidth = 2;
    ctx.stroke();

    const distance = calculateDistance(
      { x: eyeCenterX, y: eyeCenterY },
      { x: mirroredLeftX, y: leftWrist.y },
    );
    ctx.fillStyle = 'white';
    ctx.fillText(
      `${Math.round(distance)}px`,
      (eyeCenterX + mirroredLeftX) / 2,
      (eyeCenterY + leftWrist.y) / 2,
    );
  }

  if (rightWrist) {
    const mirroredRightX = mirrorX(rightWrist.x);
    ctx.beginPath();
    ctx.moveTo(eyeCenterX, eyeCenterY);
    ctx.lineTo(mirroredRightX, rightWrist.y);
    ctx.strokeStyle = rightHandInArea && !leftHandInArea ? 'red' : 'green';
    ctx.lineWidth = 2;
    ctx.stroke();

    const distance = calculateDistance(
      { x: eyeCenterX, y: eyeCenterY },
      { x: mirroredRightX, y: rightWrist.y },
    );
    ctx.fillStyle = 'white';
    ctx.fillText(
      `${Math.round(distance)}px`,
      (eyeCenterX + mirroredRightX) / 2,
      (eyeCenterY + rightWrist.y) / 2,
    );
  }

  // Only trigger if exactly one hand is in the area (not both)
  return (
    (leftHandInArea || rightHandInArea) && !(leftHandInArea && rightHandInArea)
  );
}

function calculateDistance(point1, point2) {
  return Math.sqrt(
    Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2),
  );
}

function showNotification() {
  try {
    // Send through Electron IPC first
    console.log('Sending notification through IPC...');
    ipcRenderer.send('show-notification', {
      title: 'Hair Pulling Alert',
      body: 'You might be pulling your hair. Try to be mindful of this behavior.',
    });

    // Try browser notification as backup
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Hair Pulling Alert', {
        body: 'You might be pulling your hair. Try to be mindful of this behavior.',
        requireInteraction: true,
        silent: false,
        tag: 'hair-pulling', // Prevent duplicate notifications
      });
    }
  } catch (error) {
    console.error('Error showing notification:', error);
  }
}

function updateDebugInfo(handNearHead, count, poses) {
  const debugDiv = document.getElementById('debug');
  if (!debugDiv) {
    const div = document.createElement('div');
    div.id = 'debug';
    div.style.position = 'fixed';
    div.style.bottom = '20px';
    div.style.left = '20px';
    div.style.backgroundColor = 'rgba(0,0,0,0.7)';
    div.style.color = 'white';
    div.style.padding = '10px';
    div.style.borderRadius = '5px';
    document.body.appendChild(div);
  }

  const pose = poses[0];
  const nose = pose.keypoints.find((kp) => kp.name === 'nose');
  const leftWrist = pose.keypoints.find((kp) => kp.name === 'left_wrist');
  const rightWrist = pose.keypoints.find((kp) => kp.name === 'right_wrist');

  document.getElementById('debug').innerHTML = `
    Hand near head: ${handNearHead}<br>
    Frame count: ${count}/${FRAMES_THRESHOLD}<br>
    Pose score: ${pose.score?.toFixed(2)}<br>
    Nose score: ${nose?.score?.toFixed(2)}<br>
    Left wrist score: ${leftWrist?.score?.toFixed(2)}<br>
    Right wrist score: ${rightWrist?.score?.toFixed(2)}
  `;
}

async function detectPose() {
  if (!detector || !video || video.paused || video.ended) {
    console.log('Detector or video not ready');
    requestAnimationFrame(detectPose);
    return;
  }

  try {
    // Get video frame dimensions
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    if (!videoWidth || !videoHeight) {
      console.log('Video dimensions not ready');
      requestAnimationFrame(detectPose);
      return;
    }

    const poses = await detector.estimatePoses(video);
    const statusDiv = document.getElementById('status');

    if (poses.length > 0) {
      statusDiv.textContent = 'Monitoring active';
      statusDiv.className = 'detection-active';

      // Draw all detected keypoints
      drawKeypoints(poses[0].keypoints);

      const handNearHead = isHandNearHead(poses[0].keypoints);
      updateDebugInfo(handNearHead, handNearHeadCount, poses);

      if (handNearHead) {
        handNearHeadCount++;
        console.log(
          `Hand near head count: ${handNearHeadCount}/${FRAMES_THRESHOLD}`,
        );
        if (handNearHeadCount >= FRAMES_THRESHOLD && !lastHandNearHead) {
          statusDiv.textContent = 'Warning: Hand near head detected!';
          statusDiv.className = 'detection-warning';
          showNotification();
          lastHandNearHead = true;
        }
      } else {
        handNearHeadCount = 0;
        lastHandNearHead = false;
      }
    } else {
      console.log('No poses detected');
      statusDiv.textContent = 'No pose detected';
    }
  } catch (error) {
    console.error('Error in pose detection:', error);
  }

  requestAnimationFrame(detectPose);
}

async function app() {
  try {
    console.log('Starting camera setup...');
    await setupCamera();
    console.log('Camera setup complete');

    // Request notification permission
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      console.log('Notification permission:', permission);
    }

    console.log('Initializing detector...');
    await initializeDetector();

    console.log('Starting pose detection...');
    detectPose();
  } catch (error) {
    console.error('Error in app initialization:', error);
    document.getElementById('status').textContent = 'Error: ' + error.message;
  }
}

// Add IPC response listener
ipcRenderer.on('notification-sent', (event, success) => {
  console.log(
    'Notification status:',
    success ? 'sent successfully' : 'failed to send',
  );
});

// Add notification permission request at startup
async function requestNotificationPermission() {
  if ('Notification' in window) {
    const permission = await Notification.requestPermission();
    console.log('Browser notification permission:', permission);
  }

  // Also check system notification support
  ipcRenderer.send('check-notification-support');
}

// Listen for notification support response
ipcRenderer.on('notification-support', (event, isSupported) => {
  console.log('System notifications supported:', isSupported);
});

app();
