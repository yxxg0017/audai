# Design Document

## 1. Product Goal

To be completed after the project idea is finalized.

## 2. Planned User Stories

| ID | User Story | Priority | Status |
| --- | --- | --- | --- |
| US-001 | As a user, I want to start a camera and microphone conversation with AI, so that I can ask questions about what is in front of me. | High | Planned |

## 3. Implemented User Stories

To be updated after implementation.

## 4. Core Interaction Flow

To be completed after the technical plan is finalized.

## 5. Technical Architecture

To be completed after the technical plan is finalized.

## 6. Visual Understanding Strategy

To be completed after model and capture strategy are selected.

## 7. Voice Interaction Strategy

To be completed after speech input/output strategy is selected.

## 8. Cost-Control Ideas Considered

- Capture video frames at controlled intervals instead of streaming every frame to the cloud.
- Send lower-resolution frames when full resolution is unnecessary.
- Use voice activity detection to avoid transcribing silence.
- Cache recent visual context and avoid repeated model calls for unchanged scenes.
- Use local browser APIs where practical, such as camera capture, microphone capture, and speech synthesis.
- Provide user-controlled capture and analysis modes.

## 9. Cost-Control Techniques Adopted

- The browser keeps the camera preview local and does not upload a continuous video stream.
- The app captures and uploads one compressed frame only when the user explicitly analyzes the screen or asks a visual question by voice.
- Captured frames are resized locally to a maximum width of 768px before analysis.
- Vision requests use low-detail image input, a capped question length, and a capped image data URL size.
- Recent visual summaries are cached for 60 seconds so repeated follow-up questions can reuse context.
- `/api/vision` limits each client fingerprint to 20 requests per hour.
- `/api/realtime/session` limits each client fingerprint to 12 session creations per hour.
- The Realtime system prompt asks the assistant to keep normal answers within three sentences.
- The UI displays vision request count, cache hit count, and the latest compressed frame size for demo and debugging.

## 10. Known Limitations

To be updated before final submission.

## 11. Verification

To be updated with actual test steps and demo evidence.
