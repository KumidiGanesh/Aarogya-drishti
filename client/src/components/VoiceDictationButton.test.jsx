import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const recognitionState = vi.hoisted(() => ({
  supported: true,
  listening: false,
  transcript: '',
  error: '',
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('../hooks/useSpeechRecognition.js', () => ({
  default: () => recognitionState,
}));

import i18n from '../i18n/index.js';
import VoiceDictationButton from './VoiceDictationButton.jsx';

describe('voice dictation button', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    recognitionState.supported = true;
    recognitionState.listening = false;
    recognitionState.transcript = '';
    recognitionState.error = '';
    await i18n.changeLanguage('en');
  });

  it('starts recognition for the selected field and applies the final transcript once', async () => {
    const onTranscript = vi.fn();
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <VoiceDictationButton fieldLabel="Full name" language="te" onTranscript={onTranscript} />
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dictate to Full name' }));
    expect(recognitionState.start).toHaveBeenCalledOnce();

    recognitionState.listening = true;
    recognitionState.transcript = 'Ravi Kumar';
    rerender(
      <I18nextProvider i18n={i18n}>
        <VoiceDictationButton fieldLabel="Full name" language="te" onTranscript={onTranscript} />
      </I18nextProvider>,
    );
    recognitionState.listening = false;
    rerender(
      <I18nextProvider i18n={i18n}>
        <VoiceDictationButton fieldLabel="Full name" language="te" onTranscript={onTranscript} />
      </I18nextProvider>,
    );

    await waitFor(() => expect(onTranscript).toHaveBeenCalledExactlyOnceWith('Ravi Kumar'));
  });

  it('disables dictation when browser speech recognition is unavailable', () => {
    recognitionState.supported = false;
    render(
      <I18nextProvider i18n={i18n}>
        <VoiceDictationButton fieldLabel="Full name" language="en" onTranscript={vi.fn()} />
      </I18nextProvider>,
    );

    expect(screen.getByRole('button', { name: 'Dictate to Full name' })).toBeDisabled();
  });

  it('announces microphone permission errors', () => {
    recognitionState.error = 'permission-denied';
    render(
      <I18nextProvider i18n={i18n}>
        <VoiceDictationButton fieldLabel="Full name" language="en" onTranscript={vi.fn()} />
      </I18nextProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Microphone permission was denied. Type your message instead.',
    );
  });
});
