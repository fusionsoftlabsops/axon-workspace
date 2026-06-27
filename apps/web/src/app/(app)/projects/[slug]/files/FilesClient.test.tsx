import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_FILE_BYTES } from '@/lib/files';

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh }) }));

import { FilesClient } from './FilesClient';

type FileView = React.ComponentProps<typeof FilesClient>['files'][number];

function file(over: Partial<FileView> = {}): FileView {
  return {
    id: 'f1',
    name: 'photo.png',
    mimeType: 'image/png',
    size: 2048,
    category: 'IMAGE',
    createdAt: new Date('2024-03-01').toISOString(),
    uploadedById: 'u1',
    uploaderName: 'Alice',
    ...over,
  };
}

const baseProps = (over: Partial<React.ComponentProps<typeof FilesClient>> = {}) => ({
  slug: 'proj',
  role: 'OWNER' as const,
  currentUserId: 'u1',
  files: [file(), file({ id: 'f2', name: 'doc.pdf', mimeType: 'application/pdf', category: 'PDF', uploadedById: 'u2' })],
  ...over,
});

function fileInput() {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

describe('FilesClient', () => {
  beforeEach(() => {
    nav.refresh.mockReset();
    vi.unstubAllGlobals();
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('renders grouped files with image thumbnail and download links', () => {
    render(<FilesClient {...baseProps()} />);
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    expect(screen.getByAltText('photo.png')).toBeInTheDocument();
    expect(screen.getAllByText('Download').length).toBe(2);
  });

  it('hides the dropzone for viewers and shows the read-only empty hint', () => {
    render(<FilesClient {...baseProps({ role: 'VIEWER', files: [] })} />);
    expect(screen.queryByText('Choose files')).not.toBeInTheDocument();
    expect(screen.getByText(/When the team uploads files/)).toBeInTheDocument();
  });

  it('shows the writer empty hint', () => {
    render(<FilesClient {...baseProps({ files: [] })} />);
    expect(screen.getByText(/Upload the first one/)).toBeInTheDocument();
  });

  it('rejects files over the size limit', async () => {
    const user = userEvent.setup();
    render(<FilesClient {...baseProps({ files: [] })} />);
    const big = new File(['x'], 'big.bin');
    Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
    await user.upload(fileInput(), big);
    expect(await screen.findByText(/exceeds the/)).toBeInTheDocument();
  });

  it('uploads successfully and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<FilesClient {...baseProps({ files: [] })} />);
    await user.upload(fileInput(), new File(['x'], 'small.txt'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects/proj/files', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
  });

  it('shows server error on failed upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'too big server' }) }));
    const user = userEvent.setup();
    render(<FilesClient {...baseProps({ files: [] })} />);
    await user.upload(fileInput(), new File(['x'], 'small.txt'));
    expect(await screen.findByText('too big server')).toBeInTheDocument();
  });

  it('shows a network error when upload throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const user = userEvent.setup();
    render(<FilesClient {...baseProps({ files: [] })} />);
    await user.upload(fileInput(), new File(['x'], 'small.txt'));
    expect(await screen.findByText(/Network error/)).toBeInTheDocument();
  });

  it('deletes a file after confirm', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<FilesClient {...baseProps()} />);
    await user.click(screen.getAllByText('Delete')[0]!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects/proj/files/f1', { method: 'DELETE' }),
    );
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
  });

  it('shows an error when delete fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'del-fail' }) }));
    const user = userEvent.setup();
    render(<FilesClient {...baseProps()} />);
    await user.click(screen.getAllByText('Delete')[0]!);
    expect(await screen.findByText('del-fail')).toBeInTheDocument();
  });

  it('does not delete when confirm is cancelled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => false));
    const user = userEvent.setup();
    render(<FilesClient {...baseProps()} />);
    await user.click(screen.getAllByText('Delete')[0]!);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides delete for non-owners on files they do not own', () => {
    render(<FilesClient {...baseProps({ role: 'MEMBER', currentUserId: 'u1' })} />);
    // f1 owned by u1 -> deletable; f2 owned by u2 -> not deletable for a MEMBER
    expect(screen.getAllByText('Delete').length).toBe(1);
  });

  it('handles drag over, leave and drop', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<FilesClient {...baseProps({ files: [] })} />);
    const dropzone = document.querySelector('input[type="file"]')!.parentElement as HTMLElement;
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.dragOver(dropzone);
    fireEvent.dragLeave(dropzone);
    fireEvent.drop(dropzone, { dataTransfer: { files: [new File(['x'], 'd.txt')] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it('ignores an empty upload list', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<FilesClient {...baseProps({ files: [] })} />);
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.drop(document.querySelector('input[type="file"]')!.parentElement as HTMLElement, {
      dataTransfer: { files: [] },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
