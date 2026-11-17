import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Maximize,
  Mic,
  MicOff,
  PhoneOff,
  PictureInPicture2,
  Video,
  VideoOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { emitSignal } from '../../services/signaling.js';

function mediaErrorKey(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
    return 'microphoneDenied';
  }
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return 'mediaDeviceMissing';
  }
  return 'mediaDeviceError';
}

function descriptionObject(description) {
  return { type: description.type, sdp: description.sdp };
}

export default function WebRtcCallRoom({ socket, call, onCallUpdate, onEnd }) {
  const { t } = useTranslation();
  const roomRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const callRef = useRef(call);
  const joinedTokenRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const pendingIceRestartRef = useRef(false);
  const connectedAtRef = useRef(null);
  const offerInProgressRef = useRef(false);
  const restartCountRef = useRef(0);
  const disconnectTimerRef = useRef(null);
  const [mediaConsent, setMediaConsent] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [activeMode, setActiveMode] = useState(call.type);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [cameraFacing, setCameraFacing] = useState('user');
  const [status, setStatus] = useState(call.status === 'accepted' ? 'ready' : 'ringing');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [quality, setQuality] = useState('unknown');
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  callRef.current = call;

  const emitForCall = useCallback(
    (event, payload = {}) => {
      const current = callRef.current;
      return emitSignal(socket, event, {
        consultation_id: current.consultationId,
        call_id: current.callId,
        ...payload,
      });
    },
    [socket],
  );

  const startOffer = useCallback(
    async (iceRestart = false) => {
      const peer = peerRef.current;
      if (
        !peer ||
        !callRef.current.initiatedByMe ||
        offerInProgressRef.current
      ) {
        return;
      }
      offerInProgressRef.current = true;
      try {
        if (peer.signalingState !== 'stable') {
          if (iceRestart && peer.signalingState === 'have-local-offer') {
            await peer.setLocalDescription({ type: 'rollback' });
          } else {
            return;
          }
        }
        if (iceRestart) peer.restartIce();
        const offer = await peer.createOffer(iceRestart ? { iceRestart: true } : undefined);
        await peer.setLocalDescription(offer);
        await emitForCall('call:offer', {
          description: descriptionObject(peer.localDescription),
        });
      } catch {
        setError(t('phase11.callNegotiationFailed'));
      } finally {
        offerInProgressRef.current = false;
      }
    },
    [emitForCall, t],
  );

  const joinCallRoom = useCallback(
    async (token = callRef.current.callToken) => {
      if (!token || !peerRef.current) return;
      const result = await emitSignal(socket, 'call:join', {
        consultation_id: callRef.current.consultationId,
        call_id: callRef.current.callId,
        call_token: token,
      });
      joinedTokenRef.current = token;
      if (result.peer_present) {
        await startOffer(pendingIceRestartRef.current);
        pendingIceRestartRef.current = false;
      }
      setStatus((current) => (current === 'connected' ? current : 'connecting'));
    },
    [socket, startOffer],
  );

  const refreshAndJoin = useCallback(async () => {
    const refreshed = await emitSignal(socket, 'call:resume', {
      consultation_id: callRef.current.consultationId,
      call_id: callRef.current.callId,
    });
    const updatedCall = {
      ...callRef.current,
      callToken: refreshed.call_token,
      iceServers: refreshed.ice_servers,
      status: refreshed.status,
    };
    callRef.current = updatedCall;
    onCallUpdate(updatedCall);
    await joinCallRoom(refreshed.call_token);
  }, [joinCallRoom, onCallUpdate, socket]);

  const releaseLocalMedia = () => {
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    joinedTokenRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
  };

  const handleOffer = useCallback(
    async (payload) => {
      if (payload.call_id !== callRef.current.callId || !peerRef.current) return;
      try {
        const peer = peerRef.current;
        if (peer.signalingState !== 'stable') await peer.setLocalDescription({ type: 'rollback' });
        await peer.setRemoteDescription(payload.description);
        for (const candidate of pendingCandidatesRef.current.splice(0)) {
          await peer.addIceCandidate(candidate);
        }
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await emitForCall('call:answer', {
          description: descriptionObject(peer.localDescription),
        });
        setStatus('connecting');
      } catch {
        setError(t('phase11.callNegotiationFailed'));
      }
    },
    [emitForCall, t],
  );

  const handleAnswer = useCallback(
    async (payload) => {
      if (payload.call_id !== callRef.current.callId || !peerRef.current) return;
      try {
        await peerRef.current.setRemoteDescription(payload.description);
        for (const candidate of pendingCandidatesRef.current.splice(0)) {
          await peerRef.current.addIceCandidate(candidate);
        }
      } catch {
        setError(t('phase11.callNegotiationFailed'));
      }
    },
    [t],
  );

  const handleCandidate = useCallback(
    async (payload) => {
      if (payload.call_id !== callRef.current.callId || !peerRef.current) return;
      try {
        if (!peerRef.current.remoteDescription) {
          pendingCandidatesRef.current.push(payload.candidate);
          return;
        }
        await peerRef.current.addIceCandidate(payload.candidate);
      } catch {
        setError(t('phase11.networkConnectionFailed'));
      }
    },
    [t],
  );

  const connectMedia = async () => {
    setError('');
    setNotice('');
    if (!mediaConsent || call.status !== 'accepted') return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      setError(t('phase11.unsupportedBrowser'));
      return;
    }
    if (!Array.isArray(call.iceServers) || !call.iceServers.some((server) =>
      (Array.isArray(server.urls) ? server.urls : [server.urls])
        .some((url) => /^turns?:/i.test(url || '')),
    )) {
      setError(t('phase11.turnUnavailable'));
      return;
    }

    let stream;
    let mode = call.type;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: call.type === 'video' ? { facingMode: 'user' } : false,
      });
    } catch (deviceError) {
      if (call.type !== 'video') {
        setError(t(`phase11.${mediaErrorKey(deviceError)}`));
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        mode = 'audio';
        setNotice(t('phase11.videoFallback'));
      } catch (audioError) {
        setError(t(`phase11.${mediaErrorKey(audioError)}`));
        return;
      }
    }

    let peer;
    try {
      peer = new RTCPeerConnection({ iceServers: call.iceServers });
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    } catch {
      peer?.close();
      stream.getTracks().forEach((track) => track.stop());
      setError(t('phase11.callNegotiationFailed'));
      return;
    }
    peerRef.current = peer;
    localStreamRef.current = stream;
    setLocalStream(stream);
    setActiveMode(mode);

    peer.ontrack = (event) => {
      const [incomingStream] = event.streams;
      if (incomingStream) {
        remoteStreamRef.current = incomingStream;
        setRemoteStream(incomingStream);
      } else {
        const current = remoteStreamRef.current || new MediaStream();
        current.addTrack(event.track);
        remoteStreamRef.current = current;
        setRemoteStream(current);
      }
    };
    peer.onicecandidate = (event) => {
      if (!event.candidate || !socket.connected) return;
      void emitForCall('call:ice-candidate', { candidate: event.candidate.toJSON() })
        .catch(() => setError(t('phase11.networkConnectionFailed')));
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
        setStatus('connected');
        setError('');
      } else if (['disconnected', 'connecting'].includes(peer.connectionState)) {
        setStatus('reconnecting');
        pendingIceRestartRef.current = true;
        if (!disconnectTimerRef.current) {
          disconnectTimerRef.current = window.setTimeout(() => {
            setError(t('phase11.connectionTimeout'));
          }, 12_000);
        }
      } else if (peer.connectionState === 'failed') {
        setStatus('reconnecting');
        pendingIceRestartRef.current = true;
        if (restartCountRef.current < 1 && callRef.current.initiatedByMe) {
          restartCountRef.current += 1;
          void startOffer(true);
        } else {
          setError(t('phase11.networkConnectionFailed'));
        }
      }
    };

    try {
      await joinCallRoom();
    } catch (joinError) {
      if (['INVALID_CALL_TOKEN', 'SESSION_EXPIRED'].includes(joinError.code)) {
        try {
          await refreshAndJoin();
          return;
        } catch (resumeError) {
          releaseLocalMedia();
          setError(resumeError.code === 'SESSION_EXPIRED'
            ? t('phase11.sessionExpired')
            : t('phase11.callCouldNotJoin'));
          return;
        }
      }
      releaseLocalMedia();
      setError(joinError.code === 'APPOINTMENT_NOT_ACTIVE'
        ? t('phase11.appointmentNotActive')
        : t('phase11.callCouldNotJoin'));
    }
  };

  useEffect(() => {
    const onOffer = (payload) => void handleOffer(payload);
    const onAnswer = (payload) => void handleAnswer(payload);
    const onCandidate = (payload) => void handleCandidate(payload);
    const onParticipantJoined = (payload) => {
      if (payload.call_id === callRef.current.callId) {
        setStatus((current) => (current === 'connected' ? current : 'connecting'));
        const restart = pendingIceRestartRef.current;
        pendingIceRestartRef.current = false;
        void startOffer(restart);
      }
    };
    const onParticipantLeft = (payload) => {
      if (payload.call_id === callRef.current.callId) {
        setStatus('reconnecting');
        pendingIceRestartRef.current = true;
        setNotice(t('phase11.participantReconnecting'));
      }
    };
    const onConnect = () => {
      const current = callRef.current;
      if (
        current.status === 'accepted' &&
        localStreamRef.current &&
        joinedTokenRef.current !== current.callToken
      ) {
        void joinCallRoom().catch(() => setError(t('phase11.callCouldNotJoin')));
      }
    };
    const onDisconnect = () => {
      if (localStreamRef.current) {
        pendingIceRestartRef.current = true;
        setStatus('reconnecting');
      }
    };
    socket.on('call:offer', onOffer);
    socket.on('call:answer', onAnswer);
    socket.on('call:ice-candidate', onCandidate);
    socket.on('participant:joined', onParticipantJoined);
    socket.on('participant:left', onParticipantLeft);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('call:offer', onOffer);
      socket.off('call:answer', onAnswer);
      socket.off('call:ice-candidate', onCandidate);
      socket.off('participant:joined', onParticipantJoined);
      socket.off('participant:left', onParticipantLeft);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [handleAnswer, handleCandidate, handleOffer, joinCallRoom, socket, startOffer, t]);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
    if (remoteAudioRef.current && remoteStream) remoteAudioRef.current.srcObject = remoteStream;
  }, [remoteStream]);
  useEffect(() => {
    if (call.status !== 'accepted') return;
    setStatus((current) => (['connected', 'connecting', 'reconnecting'].includes(current) ? current : 'ready'));
  }, [call.status]);
  useEffect(() => {
    if (!call.callToken || !localStreamRef.current || call.callToken === joinedTokenRef.current) return;
    if (!call.initiatedByMe && !peerRef.current) return;
    if (!peerRef.current) return;
    void joinCallRoom(call.callToken).catch(() => setError(t('phase11.callCouldNotJoin')));
  }, [call.callToken, call.initiatedByMe, joinCallRoom, t]);
  useEffect(() => {
    if (status !== 'connected') return undefined;
    if (!connectedAtRef.current) connectedAtRef.current = Date.now();
    const timer = window.setInterval(
      () => setDuration(Math.floor((Date.now() - connectedAtRef.current) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [status]);
  useEffect(() => {
    if (status !== 'connected') return undefined;
    let active = true;
    const timer = window.setInterval(async () => {
      const peer = peerRef.current;
      if (!peer) return;
      try {
        const stats = await peer.getStats();
        let rtt = 0;
        let lost = 0;
        let received = 0;
        stats.forEach((entry) => {
          if (entry.type === 'candidate-pair' && entry.state === 'succeeded' && entry.nominated) {
            rtt = entry.currentRoundTripTime || rtt;
          }
          if (entry.type === 'inbound-rtp') {
            lost += entry.packetsLost || 0;
            received += entry.packetsReceived || 0;
          }
        });
        if (active) {
          const lossRate = lost / Math.max(1, lost + received);
          setQuality(rtt > 0.6 || lossRate > 0.1 ? 'poor' : rtt > 0.3 || lossRate > 0.04 ? 'fair' : 'good');
        }
      } catch {
        if (active) setQuality('unknown');
      }
    }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [status]);
  useEffect(() => () => {
    if (disconnectTimerRef.current) window.clearTimeout(disconnectTimerRef.current);
    peerRef.current?.close();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);
  useEffect(() => {
    const handleFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handleFullscreen);
    return () => document.removeEventListener('fullscreenchange', handleFullscreen);
  }, []);
  useEffect(() => {
    roomRef.current?.focus();
  }, []);

  const endCall = async () => {
    setStatus('ended');
    let warning = '';
    try {
      await emitForCall('call:end');
    } catch {
      warning = t('phase11.callEndNetworkWarning');
    } finally {
      onEnd(warning);
    }
  };

  const toggleAudio = () => {
    const next = !audioEnabled;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setAudioEnabled(next);
  };

  const toggleCamera = () => {
    const next = !cameraEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraEnabled(next);
  };

  const switchCamera = async () => {
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { exact: nextFacing } },
      });
      const newTrack = newStream.getVideoTracks()[0];
      const sender = peerRef.current?.getSenders().find((item) => item.track?.kind === 'video');
      if (!newTrack || !sender) throw new Error('No active video sender');
      await sender.replaceTrack(newTrack);
      localStreamRef.current.getVideoTracks().forEach((track) => {
        localStreamRef.current.removeTrack(track);
        track.stop();
      });
      localStreamRef.current.addTrack(newTrack);
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      setCameraFacing(nextFacing);
      setError('');
    } catch {
      setError(t('phase11.cameraSwitchFailed'));
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await roomRef.current?.requestFullscreen();
    } catch {
      setError(t('phase11.fullscreenUnavailable'));
    }
  };

  const openPictureInPicture = async () => {
    try {
      if (!document.pictureInPictureEnabled || !remoteVideoRef.current) {
        throw new Error('Picture-in-picture is not supported');
      }
      await remoteVideoRef.current.requestPictureInPicture();
    } catch {
      setError(t('phase11.pictureInPictureUnavailable'));
    }
  };

  const retryConnection = async () => {
    setError('');
    if (!socket.connected) {
      socket.connect();
      return;
    }
    try {
      await refreshAndJoin();
    } catch {
      setError(t('phase11.networkConnectionFailed'));
    }
  };

  const statusText = {
    ringing: t('phase11.callRinging'),
    ready: t('phase11.callAccepted'),
    connecting: t('phase11.callConnecting'),
    connected: t('phase11.callConnected'),
    reconnecting: t('phase11.callReconnecting'),
    ended: t('phase11.callEnded'),
  }[status] || t('phase11.callConnecting');
  const formattedDuration = `${String(Math.floor(duration / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}`;
  const remoteHasVideo = Boolean(remoteStream?.getVideoTracks().length);

  return (
    <section
      aria-label={t('phase11.consultationRoom')}
      aria-modal="true"
      className="webrtc-room"
      ref={roomRef}
      role="dialog"
      tabIndex="-1"
    >
      <header className="webrtc-room__header">
        <div>
          <h2>{call.participantName}</h2>
          {call.participantCode && (
            <p>{t('phase11.patientId')}: {call.participantCode}</p>
          )}
          <p>
            {t(`phase11.${activeMode}`)} · {statusText}
            {status === 'connected' && ` · ${formattedDuration}`}
          </p>
        </div>
        <span className={`webrtc-room__quality webrtc-room__quality--${quality}`}>
          {t(`phase11.connectionQuality.${quality}`)}
        </span>
      </header>

      {status === 'ringing' && (
        <div className="webrtc-room__waiting" role="status">
          <span className="webrtc-room__pulse"><Video size={28} aria-hidden="true" /></span>
          <p>{t('phase11.waitingForAcceptance')}</p>
        </div>
      )}

      {status === 'ready' && (
        <div className="webrtc-room__preflight">
          <p>{t('phase11.callConsentNotice')}</p>
          <label>
            <input
              checked={mediaConsent}
              onChange={(event) => setMediaConsent(event.target.checked)}
              type="checkbox"
            />
            {t('phase11.callConsent')}
          </label>
          <button
            className="button button--primary"
            disabled={!mediaConsent}
            onClick={() => void connectMedia()}
            type="button"
          >
            {t('phase11.enableAndJoin')}
          </button>
        </div>
      )}

      {status !== 'ringing' && status !== 'ready' && (
        <div className={`webrtc-room__media ${activeMode === 'audio' ? 'webrtc-room__media--audio' : ''}`}>
          {activeMode === 'video' && remoteHasVideo && (
            <video
              autoPlay
              className="webrtc-room__remote"
              playsInline
              ref={remoteVideoRef}
            />
          )}
          {remoteStream && (activeMode === 'audio' || !remoteHasVideo) && (
            <audio autoPlay className="sr-only" ref={remoteAudioRef} />
          )}
          {!remoteStream && (
            <div className="webrtc-room__waiting" role="status">
              <span className="webrtc-room__pulse"><Camera size={28} aria-hidden="true" /></span>
              <p>{t('phase11.waitingForParticipant')}</p>
            </div>
          )}
          {remoteStream && activeMode === 'video' && !remoteHasVideo && (
            <div className="webrtc-room__waiting" role="status">
              <span className="webrtc-room__pulse"><Mic size={28} aria-hidden="true" /></span>
              <p>{t('phase11.remoteAudioOnly')}</p>
            </div>
          )}
          {activeMode === 'video' && localStream && (
            <video
              autoPlay
              className="webrtc-room__self"
              muted
              playsInline
              ref={localVideoRef}
            />
          )}
          <div className="webrtc-room__controls" aria-label={t('phase11.meetingControls')}>
            <button
              aria-label={audioEnabled ? t('phase11.disableMicrophone') : t('phase11.enableMicrophone')}
              aria-pressed={!audioEnabled}
              className="webrtc-room__control"
              onClick={toggleAudio}
              type="button"
            >
              {audioEnabled ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
            </button>
            {activeMode === 'video' && (
              <>
                <button
                  aria-label={cameraEnabled ? t('phase11.disableCamera') : t('phase11.enableCamera')}
                  aria-pressed={!cameraEnabled}
                  className="webrtc-room__control"
                  onClick={toggleCamera}
                  type="button"
                >
                  {cameraEnabled ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}
                </button>
                <button
                  aria-label={t('phase11.switchCamera')}
                  className="webrtc-room__control"
                  onClick={() => void switchCamera()}
                  type="button"
                >
                  <Camera aria-hidden="true" />
                </button>
                <button
                  aria-label={t('phase11.pictureInPicture')}
                  className="webrtc-room__control"
                  onClick={() => void openPictureInPicture()}
                  type="button"
                >
                  <PictureInPicture2 aria-hidden="true" />
                </button>
                <button
                  aria-label={isFullscreen ? t('phase11.exitFullscreen') : t('phase11.fullscreen')}
                  className="webrtc-room__control"
                  onClick={() => void toggleFullscreen()}
                  type="button"
                >
                  <Maximize aria-hidden="true" />
                </button>
              </>
            )}
            <button
              aria-label={t('phase11.endConsultation')}
              className="webrtc-room__control webrtc-room__control--end"
              onClick={() => void endCall()}
              type="button"
            >
              <PhoneOff aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {notice && <p className="webrtc-room__notice" role="status">{notice}</p>}
      {error && <p className="webrtc-room__error" role="alert">{error}</p>}
      {status === 'reconnecting' && localStream && (
        <button className="button button--secondary" onClick={() => void retryConnection()} type="button">
          {t('phase11.retryCall')}
        </button>
      )}
      <button className="button button--secondary" onClick={() => void endCall()} type="button">
        {t('phase11.endConsultation')}
      </button>
    </section>
  );
}
