import VoiceDictationButton from '../VoiceDictationButton.jsx';

export default function Input({ label, id, icon: Icon, ...props }) {
  const { voiceLanguage, onVoiceTranscript, ...inputProps } = props;
  if (voiceLanguage && onVoiceTranscript) {
    return (
      <div className="field field--voice">
        <label className="field__input-label" htmlFor={id}>
          {label && <span className="field__label">{Icon && <Icon aria-hidden="true" size={17} />}{label}</span>}
          <input className="field__control" id={id} {...inputProps} />
        </label>
        <VoiceDictationButton
          fieldLabel={label}
          language={voiceLanguage}
          onTranscript={onVoiceTranscript}
        />
      </div>
    );
  }

  return (
    <label className="field" htmlFor={id}>
      {label && <span className="field__label">{Icon && <Icon aria-hidden="true" size={17} />}{label}</span>}
      <input className="field__control" id={id} {...inputProps} />
    </label>
  );
}
