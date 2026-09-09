#include "filesystem.h"
#include <cerrno>
#include <stdexcept>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
namespace {
std::wstring Wide(const std::string& value) {
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), value.size(), nullptr, 0);
  if (length <= 0) throw std::runtime_error("Invalid migration path.");
  std::wstring output(length, L'\0');
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), value.size(), output.data(), length) != length)
    throw std::runtime_error("Invalid migration path.");
  return output;
}
}
MigrationLock::MigrationLock(const std::string& path) {
  auto handle = CreateFileW(Wide(path).c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr,
    OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (handle == INVALID_HANDLE_VALUE) throw std::runtime_error("Migration ownership is unavailable. Close other instances and retry.");
  BY_HANDLE_FILE_INFORMATION info;
  if (!GetFileInformationByHandle(handle, &info) || (info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT))) {
    CloseHandle(handle);
    throw std::runtime_error("Migration lock is not a regular file.");
  }
  handle_ = reinterpret_cast<intptr_t>(handle);
}
void MigrationLock::Release() {
  if (handle_ == -1) return;
  CloseHandle(reinterpret_cast<HANDLE>(handle_));
  handle_ = -1;
}
void RenameDirectoryNoReplace(const std::string& previous, const std::string& current) {
  const auto source = Wide(previous);
  const auto attrs = GetFileAttributesW(source.c_str());
  if (attrs == INVALID_FILE_ATTRIBUTES || !(attrs & FILE_ATTRIBUTE_DIRECTORY) || (attrs & FILE_ATTRIBUTE_REPARSE_POINT))
    throw std::runtime_error("Migration source is not a direct directory.");
  if (!MoveFileExW(source.c_str(), Wide(current).c_str(), MOVEFILE_WRITE_THROUGH))
    throw std::runtime_error("Could not move the migration directory without replacing existing data. Windows status " + std::to_string(GetLastError()) + ".");
}
#else
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/syscall.h>
#else
#include <stdio.h>
#endif

MigrationLock::MigrationLock(const std::string& path) {
  const int handle = open(path.c_str(), O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (handle < 0) throw std::runtime_error("Could not open the migration lock.");
  struct stat info;
  if (fstat(handle, &info) != 0 || !S_ISREG(info.st_mode) || info.st_nlink != 1 || info.st_uid != geteuid()) {
    close(handle);
    throw std::runtime_error("Migration lock is not an owned regular file.");
  }
  if (flock(handle, LOCK_EX | LOCK_NB) != 0) {
    close(handle);
    throw std::runtime_error("Migration ownership is unavailable. Close other instances and retry.");
  }
  handle_ = handle;
}
void MigrationLock::Release() {
  if (handle_ == -1) return;
  close(static_cast<int>(handle_));
  handle_ = -1;
}
void RenameDirectoryNoReplace(const std::string& previous, const std::string& current) {
  struct stat info;
  if (lstat(previous.c_str(), &info) != 0 || !S_ISDIR(info.st_mode))
    throw std::runtime_error("Migration source is not a direct directory.");
#ifdef __linux__
  const auto status = syscall(SYS_renameat2, AT_FDCWD, previous.c_str(), AT_FDCWD, current.c_str(), 1 /* RENAME_NOREPLACE */);
#else
  const auto status = renameatx_np(AT_FDCWD, previous.c_str(), AT_FDCWD, current.c_str(), RENAME_EXCL);
#endif
  // There is intentionally no overwrite-capable rename fallback on unsupported filesystems.
  if (status != 0)
    throw std::runtime_error("Could not move the migration directory without replacing existing data. OS status " + std::to_string(errno) + ".");
}
#endif

MigrationLock::~MigrationLock() { Release(); }
