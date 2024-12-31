# Hair Pulling Detector

An application that uses your webcam to detect and alert you when you're pulling your hair, helping you be mindful of this behavior.

## Features

- Real-time pose detection using TensorFlow.js
- Desktop notifications when hair pulling is detected
- Visual feedback with detection area and distances
- Runs in the background with minimal UI

## Development

1. Install dependencies:

```bash
npm install
```

2. Start the development version:

```bash
npm start
```

## Building

1. Build the application:

```bash
# For development build
npm run pack

# For production build
npm run dist
```

The packaged application will be in the `dist` folder.

## Usage

1. Launch the application
2. Grant camera permissions when prompted
3. The app will monitor your hand movements
4. You'll receive notifications if hair pulling is detected
5. Click the notification to focus the app window

## System Requirements

- macOS 10.13 or later
- Webcam
- System notifications enabled
