import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WebRtcCallRoom from './WebRtcCallRoom.jsx';

const signaling = vi.hoisted(() => ({
  emitSignal: vi.fn(),
}));
vi.mock('../../services/signaling.js', () => ({ emitSignal: signaling.emitSignal }));

function createStream(tracks) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
  };
}

class MockPeerConnection {
  connectionState = 'new';
  signalingState = 'stable';
  localDescription = null;
  remoteDescription = null;
  addTrack = vi.fn();
  close = vi.fn();
  restartIce = vi.fn();
  getSenders = vi.fn(() => []);
  getStats = vi.fn(async () => new Map());
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'offer-sdp' }));
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'answer-sdp' }));
  setLocalDescription = vi.fn(async (description) => {
    this.localDescription = description;
  });
  setRemoteDescription = vi.fn(async (description) => {
    this.remoteDescription = description;
  });
  addIceCandidate = vi.fn(async () => {});
}

const acceptedCall = {
  callId: 'call-id',
  consultationId: 'consultation-id',
  type: 'video',
  status: 'accepted',
  initiatedByMe: true,
  callToken: 'short-lived-token',
  iceServers: [
    { urls: ['stun:stun.example.test:3478'] },
    { urls: ['turns:turn.example.test:5349'], username: 'temporary', credential: 'temporary' },
  ],
  participantName: 'Appointment participant',
};

const socket = {
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  signaling.emitSignal.mockResolvedValue({ peer_present: false });
  globalThis.RTCPeerConnection = MockPeerConnection;
});

describe('WebRtcCallRoom', () => {
  it('requires explicit consent and falls back to audio when camera access fails', async () => {
    const audioTrack = { kind: 'audio', enabled: true, stop: vi.fn() };
    const stream = createStream([audioTrack]);
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Camera permission denied'), { name: 'NotAllowedError' }))
      .mockResolvedValueOnce(stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    render(
      <WebRtcCallRoom
        call={acceptedCall}
        onCallUpdate={vi.fn()}
        onEnd={vi.fn()}
        socket={socket}
      />,
    );

    const join = screen.getByRole('button', { name: 'Enable devices and join' });
    expect(join).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', {
      name: 'I understand and agree to enable my microphone or camera for this call.',
    }));
    fireEvent.click(join);

    expect(await screen.findByText('Camera access failed, so this call will continue with audio only.')).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: true, video: false });
    await waitFor(() => {
      expect(signaling.emitSignal).toHaveBeenCalledWith(socket, 'call:join', {
        consultation_id: 'consultation-id',
        call_id: 'call-id',
        call_token: 'short-lived-token',
      });
    });
    expect(screen.getByRole('button', { name: 'Turn microphone off' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn microphone off' }));
    expect(audioTrack.enabled).toBe(false);
  });

  it('does not request media when no TURN relay is supplied', async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    render(
      <WebRtcCallRoom
        call={{ ...acceptedCall, iceServers: [{ urls: ['stun:stun.example.test:3478'] }] }}
        onCallUpdate={vi.fn()}
        onEnd={vi.fn()}
        socket={socket}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Enable devices and join' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Secure call relay is not configured. Contact your administrator before starting a call.',
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
