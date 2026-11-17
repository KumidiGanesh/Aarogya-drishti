import { useTranslation } from 'react-i18next';
import DiseaseNotice from './DiseaseNotice.jsx';

function ListSection({ title, items }) {
  const { t } = useTranslation();
  return (
    <section className="disease-information__section">
      <h3>{t(`diseases.${title}`)}</h3>
      <ul>
        {items.map((item) => (
          <li key={item} lang="en">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DiseaseInformation({ disease }) {
  const { t } = useTranslation();
  return (
    <div className="disease-information">
      <DiseaseNotice />
      <ListSection items={disease.common_symptoms} title="symptoms" />
      <ListSection items={disease.risk_factors} title="risks" />
      <ListSection items={disease.prevention_and_hygiene} title="prevention" />
      <section className="disease-information__section">
        <h3>{t('diseases.consult')}</h3>
        <p lang="en">{disease.when_to_consult_doctor}</p>
      </section>
    </div>
  );
}
