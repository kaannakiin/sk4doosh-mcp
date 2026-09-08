#include <node_api.h>
#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <deque>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <winternl.h>
#include <winioctl.h>
#else
#include <cerrno>
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#ifdef __linux__
#include <linux/openat2.h>
#include <sys/syscall.h>
#endif
#endif

namespace secure {
struct Failure : std::runtime_error {
  std::string code;
  int nativeError;
  explicit Failure(std::string value, int native = 0) : std::runtime_error(value), code(std::move(value)), nativeError(native) {}
};

#ifdef _WIN32
using Raw = HANDLE;
const Raw invalid = INVALID_HANDLE_VALUE;
void closeRaw(Raw h) { if (h != invalid && h != nullptr) CloseHandle(h); }
std::wstring wide(const std::string& s) {
  int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), nullptr, 0);
  if (n == 0 && !s.empty()) throw Failure("invalid_argument");
  std::wstring result(n, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), result.data(), n);
  return result;
}
std::string utf8(const std::wstring& s) {
  int n = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), nullptr, 0, nullptr, nullptr);
  if (n == 0 && !s.empty()) throw Failure("invalid_argument");
  std::string result(n, '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), result.data(), n, nullptr, nullptr);
  return result;
}
[[noreturn]] void osFailure() {
  auto e = GetLastError();
  if (e == ERROR_FILE_NOT_FOUND || e == ERROR_PATH_NOT_FOUND) throw Failure("file_not_found", static_cast<int>(e));
  if (e == ERROR_DIRECTORY) throw Failure("not_a_file", static_cast<int>(e));
  throw Failure("path_outside_root", static_cast<int>(e));
}
Raw duplicate(Raw h) {
  Raw copy;
  if (!DuplicateHandle(GetCurrentProcess(), h, GetCurrentProcess(), &copy, 0, FALSE, DUPLICATE_SAME_ACCESS)) osFailure();
  return copy;
}
#else
using Raw = int;
constexpr Raw invalid = -1;
void closeRaw(Raw h) { if (h != invalid) close(h); }
[[noreturn]] void osFailure() {
  if (errno == ENOENT) throw Failure("file_not_found");
  if (errno == ENOTDIR) throw Failure("not_a_file");
  if (errno == ELOOP || errno == EXDEV || errno == EACCES || errno == EPERM || errno == EAGAIN) throw Failure("path_outside_root");
  if (errno == ENXIO || errno == ENODEV) throw Failure("not_a_file");
  throw Failure("internal_error", errno);
}
Raw duplicate(Raw h) {
  int copy = fcntl(h, F_DUPFD_CLOEXEC, 0);
  if (copy < 0) osFailure();
  return copy;
}
#endif

struct Handle {
  Raw value = invalid;
  explicit Handle(Raw h = invalid) : value(h) {}
  ~Handle() { closeRaw(value); }
  Handle(Handle&& other) noexcept : value(std::exchange(other.value, invalid)) {}
  Handle& operator=(Handle&& other) noexcept {
    if (this != &other) { closeRaw(value); value = std::exchange(other.value, invalid); }
    return *this;
  }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
};

struct Info {
  bool directory = false, link = false, regular = false;
  uint64_t size = 0, device = 0, identity = 0, modified = 0, changed = 0;
  double modifiedMs = 0;
};
Info infoOf(Raw h) {
  Info out;
#ifdef _WIN32
  BY_HANDLE_FILE_INFORMATION s;
  FILE_BASIC_INFO basic;
  if (!GetFileInformationByHandle(h, &s) || !GetFileInformationByHandleEx(h, FileBasicInfo, &basic, sizeof(basic))) osFailure();
  out.directory = (s.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
  out.link = (s.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
  out.regular = GetFileType(h) == FILE_TYPE_DISK && !out.directory && !out.link;
  out.size = (uint64_t(s.nFileSizeHigh) << 32) | s.nFileSizeLow;
  out.device = s.dwVolumeSerialNumber;
  out.identity = (uint64_t(s.nFileIndexHigh) << 32) | s.nFileIndexLow;
  out.modified = basic.LastWriteTime.QuadPart;
  out.changed = basic.ChangeTime.QuadPart;
  out.modifiedMs = static_cast<double>(basic.LastWriteTime.QuadPart - 116444736000000000LL) / 10000.0;
#else
  struct stat s;
  if (fstat(h, &s) != 0) osFailure();
  out.directory = S_ISDIR(s.st_mode);
  out.link = S_ISLNK(s.st_mode);
  out.regular = S_ISREG(s.st_mode);
  out.size = static_cast<uint64_t>(s.st_size);
  out.device = s.st_dev;
  out.identity = s.st_ino;
#ifdef __APPLE__
  auto mt = s.st_mtimespec, ct = s.st_ctimespec;
#else
  auto mt = s.st_mtim, ct = s.st_ctim;
#endif
  out.modified = uint64_t(mt.tv_sec) * 1000000000ULL + mt.tv_nsec;
  out.changed = uint64_t(ct.tv_sec) * 1000000000ULL + ct.tv_nsec;
  out.modifiedMs = static_cast<double>(mt.tv_sec) * 1000.0 + static_cast<double>(mt.tv_nsec) / 1000000.0;
#endif
  return out;
}
bool same(const Info& a, const Info& b) {
  return a.regular == b.regular && a.device == b.device && a.identity == b.identity && a.size == b.size && a.modified == b.modified && a.changed == b.changed;
}

std::string slash(std::string s) {
#ifdef _WIN32
  std::replace(s.begin(), s.end(), '\\', '/');
#endif
  return s;
}
std::deque<std::string> parts(const std::string& input) {
  std::deque<std::string> result;
  const auto s = slash(input);
  size_t start = 0;
  while (start < s.size()) {
    auto end = s.find('/', start);
    if (end == std::string::npos) end = s.size();
    auto part = s.substr(start, end - start);
    if (!part.empty() && part != ".") result.push_back(part);
    start = end + 1;
  }
  return result;
}
std::string joined(const std::vector<std::string>& components) {
  std::string out;
  for (const auto& p : components) { if (!out.empty()) out += '/'; out += p; }
  return out;
}
bool absolute(const std::string& path) {
#ifdef _WIN32
  return !path.empty() && (path.front() == '/' || (path.size() > 1 && path[1] == ':'));
#else
  return !path.empty() && path.front() == '/';
#endif
}
struct Root {
  Handle handle;
  std::string path;
  explicit Root(const std::string& raw) : path(slash(raw)) {
    while (path.size() > 1 && path.back() == '/') path.pop_back();
#ifdef _WIN32
    handle = Handle(CreateFileW(wide(raw).c_str(), FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    if (handle.value == invalid) osFailure();
#else
    handle = Handle(open(raw.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK));
    if (handle.value < 0) osFailure();
#endif
    auto info = infoOf(handle.value);
    if (!info.directory || info.link) throw Failure("not_a_file");
  }
  std::string relativeTarget(std::string target) const {
    target = slash(std::move(target));
#ifdef _WIN32
    if (target.rfind("/?" "?/UNC/", 0) == 0) target = "//" + target.substr(8);
    else if (target.rfind("/?" "?/", 0) == 0 || target.rfind("//?/", 0) == 0) target = target.substr(4);
#endif
    if (!absolute(target)) return target;
#ifdef _WIN32
    // Expand 8.3 aliases as a spelling hint only; access still uses the root handle.
    auto spelling = wide(target);
    std::replace(spelling.begin(), spelling.end(), L'/', L'\\');
    std::vector<wchar_t> expanded(32768);
    auto length = GetLongPathNameW(spelling.c_str(), expanded.data(), static_cast<DWORD>(expanded.size()));
    if (length == 0) osFailure();
    if (length >= expanded.size()) throw Failure("resource_limit");
    target = slash(utf8(std::wstring(expanded.data(), length)));
#else
    // Absolute symlink targets may use a configured-root alias (/var vs /private/var).
    // Canonicalization is only a hint: the result is still opened through root-relative handles.
    if (target.compare(0, path.size(), path) != 0) {
      char* canonical = realpath(target.c_str(), nullptr);
      if (!canonical) { if (errno == EINVAL) throw Failure("file_changed"); osFailure(); }
      target = canonical;
      std::free(canonical);
    }
#endif
    auto prefix = path;
    auto compare = target;
#ifdef _WIN32
    auto a = wide(prefix), b = wide(compare.substr(0, prefix.size()));
    if (CompareStringOrdinal(a.c_str(), static_cast<int>(a.size()), b.c_str(), static_cast<int>(b.size()), TRUE) != CSTR_EQUAL) throw Failure("path_outside_root");
#else
    if (compare.compare(0, prefix.size(), prefix) != 0) throw Failure("path_outside_root");
#endif
    if (target.size() == prefix.size()) return "";
    if (prefix != "/" && target[prefix.size()] != '/') throw Failure("path_outside_root");
    return target.substr(prefix.size() + (prefix == "/" ? 0 : 1));
  }
};

#ifdef _WIN32
Handle openChild(Raw parent, const std::string& name) {
  if (!name.empty() && (name.find(':') != std::string::npos || name.back() == ' ' || name.back() == '.')) throw Failure("path_outside_root");
  auto w = wide(name);
  if (w.size() > 32767) throw Failure("resource_limit");
  UNICODE_STRING us{ static_cast<USHORT>(w.size() * sizeof(wchar_t)), static_cast<USHORT>(w.size() * sizeof(wchar_t)), w.data() };
  OBJECT_ATTRIBUTES attributes{};
  attributes.Length = sizeof(attributes); attributes.RootDirectory = parent; attributes.ObjectName = &us; attributes.Attributes = 0x40;
  IO_STATUS_BLOCK status{};
  HANDLE child = invalid;
  using Create = NTSTATUS(NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
  static auto create = reinterpret_cast<Create>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtCreateFile"));
  if (!create) throw Failure("unsupported_platform");
  auto result = create(&child, FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE, &attributes, &status, nullptr, 0,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, 1,
    0x00200000 | 0x00000020 | 0x00004000 | (name.empty() ? 0x00000001 : 0), nullptr, 0);
  if (result < 0) {
    if (static_cast<ULONG>(result) == 0xC0000034 || static_cast<ULONG>(result) == 0xC000003A) throw Failure("file_not_found");
    throw Failure("path_outside_root", static_cast<int>(result));
  }
  return Handle(child);
}
std::string linkTarget(Raw child) {
  alignas(8) unsigned char data[MAXIMUM_REPARSE_DATA_BUFFER_SIZE];
  DWORD length;
  if (!DeviceIoControl(child, FSCTL_GET_REPARSE_POINT, nullptr, 0, data, sizeof(data), &length, nullptr)) osFailure();
  if (length < 16) throw Failure("path_outside_root");
  DWORD tag; USHORT offset, size;
  std::memcpy(&tag, data, 4); std::memcpy(&offset, data + 8, 2); std::memcpy(&size, data + 10, 2);
  size_t base = tag == IO_REPARSE_TAG_SYMLINK ? 20 : tag == IO_REPARSE_TAG_MOUNT_POINT ? 16 : 0;
  if (base == 0 || base + offset + size > length || size % 2 || offset % 2) throw Failure("path_outside_root");
  return utf8(std::wstring(reinterpret_cast<wchar_t*>(data + base + offset), size / 2));
}
#endif

struct Resolved { Handle handle; std::string path; bool viaLink; };
Resolved resolve(const Root& root, const std::string& input) {
  if (absolute(slash(input))) throw Failure("path_outside_root");
  auto pending = parts(input);
  std::vector<Handle> chain;
  std::vector<std::string> names;
  chain.emplace_back(duplicate(root.handle.value));
  size_t links = 0;
  while (!pending.empty()) {
    auto name = pending.front(); pending.pop_front();
    if (name == "..") {
      if (chain.size() == 1) throw Failure("path_outside_root");
      chain.pop_back(); names.pop_back(); continue;
    }
    if (names.size() >= 256) throw Failure("resource_limit");
    bool isLink = false;
    std::string target;
    Handle child;
#ifdef _WIN32
    child = openChild(chain.back().value, name);
    isLink = infoOf(child.value).link;
    if (isLink) target = linkTarget(child.value);
#else
    struct stat s;
    if (fstatat(chain.back().value, name.c_str(), &s, AT_SYMLINK_NOFOLLOW) != 0) osFailure();
    isLink = S_ISLNK(s.st_mode);
    if (isLink) {
      std::vector<char> link(32769);
      auto n = readlinkat(chain.back().value, name.c_str(), link.data(), link.size());
      if (n < 0) { if (errno == EINVAL) throw Failure("file_changed"); osFailure(); }
      if (static_cast<size_t>(n) >= link.size()) throw Failure("resource_limit");
      target.assign(link.data(), static_cast<size_t>(n));
    } else {
      if (!S_ISREG(s.st_mode) && !S_ISDIR(s.st_mode)) throw Failure("not_a_file");
      child = Handle(openat(chain.back().value, name.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK | (pending.empty() ? 0 : O_DIRECTORY)));
      if (child.value < 0) osFailure();
    }
#endif
    if (isLink) {
      if (++links > 40) throw Failure("path_outside_root");
      target = slash(target);
      if (absolute(target)) {
        target = root.relativeTarget(target);
        chain.resize(1); names.clear();
      }
      auto expanded = parts(target);
      expanded.insert(expanded.end(), pending.begin(), pending.end());
      pending = std::move(expanded);
      continue;
    }
    auto info = infoOf(child.value);
    if (!info.regular && !info.directory) throw Failure("not_a_file");
    names.push_back(name);
    if (pending.empty()) {
#ifdef __linux__
      // Re-open the resolved components atomically beneath the pinned root. Never fall back on old kernels.
      struct open_how how{};
      how.flags = O_RDONLY | O_CLOEXEC | O_NONBLOCK;
      how.resolve = RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS;
      auto canonical = joined(names);
      Handle atomic(static_cast<int>(syscall(SYS_openat2, root.handle.value, canonical.c_str(), &how, sizeof(how))));
      if (atomic.value < 0) { if (errno == ENOSYS || errno == EINVAL) throw Failure("unsupported_platform"); osFailure(); }
      auto finalInfo = infoOf(atomic.value);
      if (info.device != finalInfo.device || info.identity != finalInfo.identity) throw Failure("file_changed");
      child = std::move(atomic);
#endif
      return {std::move(child), joined(names), links != 0};
    }
    if (!info.directory) throw Failure("not_a_file");
    chain.push_back(std::move(child));
  }
  return {std::move(chain.back()), joined(names), links != 0};
}

class Directory {
#ifdef _WIN32
  Handle handle;
  alignas(8) unsigned char buffer[65536];
  size_t offset = 0;
  bool first = true, refill = true;
#else
  DIR* dir;
#endif
public:
  explicit Directory(Raw h)
#ifdef _WIN32
    // An empty NT relative name reopens this directory with an independent enumeration cursor.
    : handle(openChild(h, "")) {}
#else
    : dir(nullptr) {
      int fd = openat(h, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
      if (fd < 0) osFailure();
      dir = fdopendir(fd);
      if (!dir) { close(fd); osFailure(); }
    }
  ~Directory() { if (dir) closedir(dir); }
#endif
  bool next(std::string& name) {
#ifdef _WIN32
    if (refill) {
      if (!GetFileInformationByHandleEx(handle.value, first ? FileIdBothDirectoryRestartInfo : FileIdBothDirectoryInfo, buffer, sizeof(buffer))) {
        if (GetLastError() == ERROR_NO_MORE_FILES) return false;
        osFailure();
      }
      first = false; refill = false; offset = 0;
    }
    auto* entry = reinterpret_cast<FILE_ID_BOTH_DIR_INFO*>(buffer + offset);
    if (offset + offsetof(FILE_ID_BOTH_DIR_INFO, FileName) + entry->FileNameLength > sizeof(buffer)) throw Failure("internal_error");
    name = utf8(std::wstring(entry->FileName, entry->FileNameLength / 2));
    if (entry->NextEntryOffset == 0) refill = true;
    else { offset += entry->NextEntryOffset; if (offset >= sizeof(buffer)) throw Failure("internal_error"); }
    return true;
#else
    errno = 0;
    auto* entry = readdir(dir);
    if (!entry) { if (errno) osFailure(); return false; }
    name = entry->d_name;
    return true;
#endif
  }
};

struct Entry { std::string path; Info info; };
struct Job {
  napi_env env{}; napi_async_work work{}; napi_deferred deferred{};
  std::shared_ptr<Root> root;
  std::string operation, path, error, reason;
  int nativeError = 0;
  uint32_t budget = 0, depth = 0, ms = 0, visited = 0, unreadable = 0;
  std::vector<unsigned char> bytes;
  std::vector<Entry> entries;
  Info info;
};
void readSnapshot(Job& job, Raw h) {
  auto before = infoOf(h);
  if (!before.regular) throw Failure("not_a_file");
  if (before.size > job.budget) throw Failure("file_too_large");
  job.bytes.resize(static_cast<size_t>(before.size));
  size_t offset = 0;
  while (offset < job.bytes.size()) {
    size_t amount = std::min<size_t>(65536, job.bytes.size() - offset);
#ifdef _WIN32
    DWORD n;
    if (!ReadFile(h, job.bytes.data() + offset, static_cast<DWORD>(amount), &n, nullptr)) osFailure();
#else
    auto n = pread(h, job.bytes.data() + offset, amount, static_cast<off_t>(offset));
    if (n < 0) { if (errno == EINTR) continue; osFailure(); }
#endif
    if (n == 0) throw Failure("file_changed");
    offset += static_cast<size_t>(n);
  }
  unsigned char extra;
#ifdef _WIN32
  DWORD n;
  if (!ReadFile(h, &extra, 1, &n, nullptr)) osFailure();
#else
  auto n = pread(h, &extra, 1, static_cast<off_t>(offset));
  if (n < 0) osFailure();
#endif
  if (n != 0 || !same(before, infoOf(h))) throw Failure("file_changed");
  job.info = before;
}
void scan(Job& job, Resolved base) {
  if (!infoOf(base.handle.value).directory) throw Failure("not_a_file");
  struct Frame { std::string path; uint32_t depth; std::unique_ptr<Directory> dir; };
  std::vector<Frame> stack;
  stack.push_back({base.path, 0, std::make_unique<Directory>(base.handle.value)});
  const auto start = std::chrono::steady_clock::now();
  while (!stack.empty()) {
    if (std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count() >= job.ms) { job.reason = "time"; break; }
    if (job.visited >= job.budget) { job.reason = "entries"; break; }
    std::string name;
    if (!stack.back().dir->next(name)) { stack.pop_back(); continue; }
    if (name == "." || name == "..") continue;
    ++job.visited;
    const auto path = stack.back().path.empty() ? name : stack.back().path + "/" + name;
    const auto depth = stack.back().depth;
    try {
      auto child = resolve(*job.root, path);
      auto info = infoOf(child.handle.value);
      if (info.directory) {
        job.entries.push_back({path, info});
        if (!child.viaLink) {
          if (depth >= job.depth) { job.reason = "depth"; continue; }
          stack.push_back({path, depth + 1, std::make_unique<Directory>(child.handle.value)});
        }
      } else if (info.regular) job.entries.push_back({path, info});
    } catch (const Failure& e) {
      if (e.code == "unsupported_platform" || e.code == "internal_error") throw;
      ++job.unreadable;
    }
  }
}
void execute(napi_env, void* data) {
  auto& job = *static_cast<Job*>(data);
  try {
    auto opened = resolve(*job.root, job.path);
    if (job.operation == "read") readSnapshot(job, opened.handle.value);
    else if (job.operation == "scan") scan(job, std::move(opened));
    else if (job.operation == "resolve") job.path = opened.path;
    else throw Failure("invalid_argument");
  } catch (const Failure& error) { job.error = error.code; job.nativeError = error.nativeError; }
  catch (...) { job.error = "internal_error"; }
}
napi_value string(napi_env env, const std::string& value) {
  napi_value out; napi_create_string_utf8(env, value.data(), value.size(), &out); return out;
}
void prop(napi_env env, napi_value object, const char* name, napi_value value) { napi_set_named_property(env, object, name, value); }
void number(napi_env env, napi_value object, const char* name, double value) { napi_value n; napi_create_double(env, value, &n); prop(env, object, name, n); }
napi_value errorValue(napi_env env, const std::string& code) {
  napi_value error; napi_create_error(env, nullptr, string(env, "Secure filesystem operation failed."), &error); prop(env, error, "code", string(env, code)); return error;
}
void complete(napi_env env, napi_status status, void* data) {
  std::unique_ptr<Job> job(static_cast<Job*>(data));
  if (status != napi_ok && job->error.empty()) job->error = "internal_error";
  if (!job->error.empty()) {
    auto error = errorValue(env, job->error);
    number(env, error, "nativeError", job->nativeError);
    napi_reject_deferred(env, job->deferred, error);
  }
  else {
    napi_value result;
    if (job->operation == "resolve") result = string(env, job->path);
    else {
      napi_create_object(env, &result);
      if (job->operation == "read") {
        napi_value buffer;
        napi_create_buffer_copy(env, job->bytes.size(), job->bytes.data(), nullptr, &buffer);
        prop(env, result, "bytes", buffer); number(env, result, "size", static_cast<double>(job->info.size)); number(env, result, "modifiedMs", job->info.modifiedMs);
      } else {
        napi_value array; napi_create_array_with_length(env, job->entries.size(), &array);
        for (size_t i = 0; i < job->entries.size(); ++i) {
          napi_value entry, directory; napi_create_object(env, &entry);
          prop(env, entry, "path", string(env, job->entries[i].path));
          number(env, entry, "size", static_cast<double>(job->entries[i].info.size)); number(env, entry, "modifiedMs", job->entries[i].info.modifiedMs);
          napi_get_boolean(env, job->entries[i].info.directory, &directory); prop(env, entry, "directory", directory);
          napi_set_element(env, array, static_cast<uint32_t>(i), entry);
        }
        prop(env, result, "entries", array); number(env, result, "visited", job->visited); number(env, result, "unreadable", job->unreadable);
        napi_value reason; if (job->reason.empty()) napi_get_null(env, &reason); else reason = string(env, job->reason); prop(env, result, "reason", reason);
      }
    }
    napi_resolve_deferred(env, job->deferred, result);
  }
  napi_delete_async_work(env, job->work);
}
std::string argument(napi_env env, napi_value value) {
  size_t length;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok || length > 131072) throw Failure("invalid_argument");
  std::vector<char> buffer(length + 1);
  napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length);
  std::string result(buffer.data(), length);
  if (result.find('\0') != std::string::npos) throw Failure("invalid_argument");
  return result;
}
napi_value openRoot(napi_env env, napi_callback_info info) {
  try {
    size_t argc = 1; napi_value argv[1]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc != 1) throw Failure("invalid_argument");
    auto root = std::make_unique<std::shared_ptr<Root>>(std::make_shared<Root>(argument(env, argv[0])));
    napi_value out;
    napi_create_external(env, root.get(), [](napi_env, void* data, void*) { delete static_cast<std::shared_ptr<Root>*>(data); }, nullptr, &out);
    root.release(); return out;
  } catch (const Failure& error) { napi_throw(env, errorValue(env, error.code)); }
  catch (...) { napi_throw(env, errorValue(env, "internal_error")); }
  return nullptr;
}
napi_value run(napi_env env, napi_callback_info info) {
  try {
    size_t argc = 6; napi_value argv[6]; napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc != 6) throw Failure("invalid_argument");
    void* ptr;
    if (napi_get_value_external(env, argv[0], &ptr) != napi_ok || !ptr) throw Failure("invalid_argument");
    auto job = std::make_unique<Job>();
    job->env = env; job->root = *static_cast<std::shared_ptr<Root>*>(ptr);
    job->operation = argument(env, argv[1]); job->path = argument(env, argv[2]);
    if (napi_get_value_uint32(env, argv[3], &job->budget) != napi_ok || napi_get_value_uint32(env, argv[4], &job->depth) != napi_ok || napi_get_value_uint32(env, argv[5], &job->ms) != napi_ok) throw Failure("invalid_argument");
    if (job->budget > 50 * 1024 * 1024 || job->depth > 64 || job->ms > 1000 || (job->operation == "scan" && job->budget > 5000)) throw Failure("invalid_argument");
    napi_value promise; napi_create_promise(env, &job->deferred, &promise);
    napi_create_async_work(env, nullptr, string(env, "secure-filesystem"), execute, complete, job.get(), &job->work);
    napi_queue_async_work(env, job->work); job.release(); return promise;
  } catch (const Failure& error) { napi_throw(env, errorValue(env, error.code)); }
  catch (...) { napi_throw(env, errorValue(env, "internal_error")); }
  return nullptr;
}
napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "openRoot", NAPI_AUTO_LENGTH, openRoot, nullptr, &fn); prop(env, exports, "openRoot", fn);
  napi_create_function(env, "run", NAPI_AUTO_LENGTH, run, nullptr, &fn); prop(env, exports, "run", fn);
  return exports;
}
}  // namespace secure
NAPI_MODULE(NODE_GYP_MODULE_NAME, secure::init)
