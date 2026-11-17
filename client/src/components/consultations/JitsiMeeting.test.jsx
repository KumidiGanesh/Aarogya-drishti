import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JitsiMeeting from './JitsiMeeting.jsx';

const labels = {
  join: 'Join consultation',
  loading: 'Connecting',
  unavailable: 'Unavailable',
  openInNewTab: 'Open meeting',
  meetingControls: 'Call controls',
  enableMicrophone: 'Turn microphone on',
  disableMicrophone: 'Turn microphone off',
  enableCamera: 'Turn camera on',
  disableCamera: 'Turn camera off',
  startScreenShare: 'Share screen',
  stopScreenShare: 'Stop sharing screen',
  deviceError: 'Device access failed',
  controlError: 'Control unavailable',
};

afterEach(() => {
  delete window.JitsiMeetExternalAPI;
});

describe('JitsiMeeting', () => {
  it('initializes audio-only meetings without enabling the camera and keeps the meeting mounted', async () => {
    const listeners = {};
    const meeting = {
      addListener: vi.fn((event, callback) => {
        listeners[event] = callback;
      }),
      removeListener: vi.fn(),
      dispose: vi.fn(),
      executeCommand: vi.fn(),
    };
    const externalApi = vi.fn(function ExternalApi() {
      return meeting;
    });
    window.JitsiMeetExternalAPI = externalApi;
    const join = {
      domain: 'meet.jit.si',
      room: 'aarogya-test-room',
      audio_only: true,
      display_name: 'Patient',
      token: null,
    };
    const onLeave = vi.fn();
    const { rerender, unmount } = render(
      <JitsiMeeting join={join} labels={labels} onLeave={onLeave} />,
    );

    await waitFor(() => expect(externalApi).toHaveBeenCalledTimes(1));
    const options = externalApi.mock.calls[0][1];
    expect(options.configOverwrite).toMatchObject({
      startWithVideoMuted: true,
      disableVideo: true,
      toolbarButtons: ['microphone', 'hangup', 'chat', 'tileview'],
    });
    expect(options.configOverwrite.toolbarButtons).not.toContain('camera');
    await waitFor(() => expect(meeting.addListener).toHaveBeenCalledWith('readyToClose', onLeave));
    act(() => listeners.videoConferenceJoined());
    expect(await screen.findByRole('button', { name: 'Turn microphone on' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn camera on' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share screen' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn microphone on' }));
    expect(meeting.executeCommand).toHaveBeenCalledWith('toggleAudio');

    rerender(<JitsiMeeting join={join} labels={{ ...labels }} onLeave={onLeave} />);
    expect(externalApi).toHaveBeenCalledTimes(1);

    unmount();
    expect(meeting.removeListener).toHaveBeenCalledWith('readyToClose', onLeave);
    expect(meeting.dispose).toHaveBeenCalledTimes(1);
  });

  it('exposes camera and optional screen sharing to video-call participants', async () => {
    const listeners = {};
    const meeting = {
      addListener: vi.fn((event, callback) => {
        listeners[event] = callback;
      }),
      removeListener: vi.fn(),
      dispose: vi.fn(),
      executeCommand: vi.fn(),
    };
    const externalApi = vi.fn(function ExternalApi() {
      return meeting;
    });
    window.JitsiMeetExternalAPI = externalApi;
    const join = {
      domain: 'meet.jit.si',
      room: 'aarogya-video-room',
      audio_only: false,
      display_name: 'Patient',
      token: null,
    };
    render(<JitsiMeeting join={join} labels={labels} onLeave={vi.fn()} />);

    await waitFor(() => expect(externalApi).toHaveBeenCalledTimes(1));
    expect(externalApi.mock.calls[0][1].configOverwrite.toolbarButtons).toContain('camera');
    expect(externalApi.mock.calls[0][1].configOverwrite.toolbarButtons).toContain('desktop');
    act(() => listeners.videoConferenceJoined());

    fireEvent.click(await screen.findByRole('button', { name: 'Turn camera on' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share screen' }));
    expect(meeting.executeCommand).toHaveBeenNthCalledWith(1, 'toggleVideo');
    expect(meeting.executeCommand).toHaveBeenNthCalledWith(2, 'toggleShareScreen');

    act(() => listeners.screenSharingStatusChanged({ on: true }));
    expect(await screen.findByRole('button', { name: 'Stop sharing screen' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
