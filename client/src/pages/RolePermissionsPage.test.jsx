import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui/Toast.jsx';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../services/api.js', () => ({ default: mockApi }));

import i18n from '../i18n/index.js';
import RolePermissionsPage from './RolePermissionsPage.jsx';

describe('role permission management', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem('aarogya-language', 'en');
    await i18n.changeLanguage('en');
    mockApi.get.mockResolvedValue({
      data: {
        data: {
          permissions: [
            { code: 'patients:read', description: 'View permitted patient records' },
            { code: 'screenings:read', description: 'View permitted screening records' },
          ],
          roles: [
            { name: 'super_admin', permissions: ['patients:read', 'screenings:read'], editable: false },
            { name: 'doctor', permissions: ['patients:read', 'screenings:read'], editable: true },
          ],
        },
      },
    });
    mockApi.put.mockResolvedValue({
      data: {
        data: {
          role: {
            name: 'doctor',
            permissions: ['screenings:read'],
            editable: true,
          },
        },
      },
    });
  });

  it('lets a super admin update a role permission through the management API', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ToastProvider>
            <RolePermissionsPage />
          </ToastProvider>
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Role permissions' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'doctor' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /patients:read/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save role permissions' }));

    await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith(
      '/admin/roles/doctor/permissions',
      { permissions: ['screenings:read'] },
    ));
  });
});
