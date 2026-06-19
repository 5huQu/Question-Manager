export const libreOfficeDownloadUrl = 'https://www.libreoffice.org/download/'

export function isWordFileName(name: string) {
  return /\.(doc|docx)$/i.test(name.trim())
}

export function fileListHasWord(files: FileList | null | undefined) {
  return Array.from(files ?? []).some((file) => isWordFileName(file.name))
}

