import { useEffect, useRef, useState } from 'react';

const scriptLoads = new Map();
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

function loadJitsiApi(domain) {
  if (window.JitsiMeetExternalAPI) return Promise.resolve(window.JitsiMeetExternalAPI);
  if (scriptLoads.has(domain)) return scriptLoads.get(domain);

  const load = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://${domain}/external_api.js`;
    script.async = true;
    script.onload = () => {
      if (window.JitsiMeetExternalAPI) resolve(window.JitsiMeetExternalAPI);
      else {
        scriptLoads.delete(domain);
        reject(new Error('The video meeting provider did not initialize'));
      }
    };
    script.onerror = () => {
      scriptLoads.delete(domain);
      reject(new Error('The video meeting provider could not be loaded'));
    };
    document.head.appendChild(script);
  });
  scriptLoads.set(domain, load);
  return load;
}

export default function JitsiMeeting({ join, onLeave, labels }) {
  const containerRef = useRef(null);
  const meetingRef = useRef(null);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const [error, setError] = useState('');
  const [controlError, setControlError] = useState('');
  const [meetingJoined, setMeetingJoined] = useState(false);
  const [audioMuted, setAudioMuted] = useState(true);
  const [videoMuted, setVideoMuted] = useState(true);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let meeting;
    const domain = String(join?.domain || '');
    const room = String(join?.room || '');
    const validDomain = domainPattern.test(domain);
    const validRoom = /^[a-zA-Z0-9_-]{1,128}$/.test(room);
    if (!validDomain || !validRoom) {
      setError(labelsRef.current.unavailable);
      setLoading(false);
      return undefined;
    }

    loadJitsiApi(domain)
      .then((JitsiMeetExternalAPI) => {
        if (!active || !containerRef.current) return;
        meeting = new JitsiMeetExternalAPI(domain, {
          roomName: room,
          parentNode: containerRef.current,
          width: '100%',
          height: '100%',
          ...(join.token ? { jwt: join.token } : {}),
          userInfo: { displayName: join.display_name || '' },
          configOverwrite: {
            prejoinPageEnabled: true,
            startWithAudioMuted: true,
            startWithVideoMuted: true,
            ...(join.audio_only
              ? {
                  disableVideo: true,
                  disableScreensharing: true,
                  toolbarButtons: ['microphone', 'hangup', 'chat', 'tileview'],
                }
              : {
                  toolbarButtons: ['microphone', 'camera', 'desktop', 'hangup', 'chat', 'tileview'],
                }),
            disableDeepLinking: true,
          },
        });
        meetingRef.current = meeting;
        meeting.addListener('readyToClose', onLeave);
        meeting.addListener('videoConferenceJoined', () => {
          if (active) setMeetingJoined(true);
        });
        meeting.addListener('audioMuteStatusChanged', ({ muted }) => {
          if (active) setAudioMuted(Boolean(muted));
        });
        meeting.addListener('videoMuteStatusChanged', ({ muted }) => {
          if (active) setVideoMuted(Boolean(muted));
        });
        meeting.addListener('screenSharingStatusChanged', ({ on }) => {
          if (active) setSharingScreen(Boolean(on));
        });
        meeting.addListener('cameraError', () => {
          if (active) setControlError(labelsRef.current.deviceError);
        });
        meeting.addListener('micError', () => {
          if (active) setControlError(labelsRef.current.deviceError);
        });
        if (active) setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError(labelsRef.current.unavailable);
          setLoading(false);
        }
      });

    return () => {
      active = false;
      meetingRef.current = null;
      meeting?.removeListener('readyToClose', onLeave);
      meeting?.dispose();
    };
  }, [join, onLeave]);

  const executeCommand = (command) => {
    try {
      meetingRef.current?.executeCommand(command);
      setControlError('');
    } catch {
      setControlError(labelsRef.current.controlError);
    }
  };

  return (
    <div className="consultation-meeting">
      {loading && <p className="consultation-meeting__status">{labels.loading}</p>}
      {error && (
        <p className="consultation-meeting__error" role="alert">
          {error}
        </p>
      )}
      <div aria-label={labels.join} className="consultation-meeting__provider" ref={containerRef} />
      {meetingJoined && (
        <div aria-label={labels.meetingControls} className="consultation-meeting__controls">
          <button
            aria-pressed={!audioMuted}
            className="button button--secondary"
            onClick={() => executeCommand('toggleAudio')}
            type="button"
          >
            {audioMuted ? labels.enableMicrophone : labels.disableMicrophone}
          </button>
          {!join.audio_only && (
            <>
              <button
                aria-pressed={!videoMuted}
                className="button button--secondary"
                onClick={() => executeCommand('toggleVideo')}
                type="button"
              >
                {videoMuted ? labels.enableCamera : labels.disableCamera}
              </button>
              <button
                aria-pressed={sharingScreen}
                className="button button--secondary"
                onClick={() => executeCommand('toggleShareScreen')}
                type="button"
              >
                {sharingScreen ? labels.stopScreenShare : labels.startScreenShare}
              </button>
            </>
          )}
        </div>
      )}
      {controlError && (
        <p className="consultation-meeting__error" role="alert">
          {controlError}
        </p>
      )}
      {error &&
        domainPattern.test(String(join?.domain || '')) &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(String(join?.room || '')) && (
          <a
            className="button button--outline"
            href={`https://${join.domain}/${encodeURIComponent(join.room)}`}
            rel="noreferrer"
            target="_blank"
          >
            {labels.openInNewTab}
          </a>
        )}
    </div>
  );
}
