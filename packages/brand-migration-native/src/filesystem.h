#pragma once
#include <cstdint>
#include <string>

class MigrationLock {
 public:
  explicit MigrationLock(const std::string& path);
  ~MigrationLock();
  MigrationLock(const MigrationLock&) = delete;
  MigrationLock& operator=(const MigrationLock&) = delete;
  void Release();
 private:
  intptr_t handle_ = -1;
};
void RenameDirectoryNoReplace(const std::string& previous, const std::string& current);
