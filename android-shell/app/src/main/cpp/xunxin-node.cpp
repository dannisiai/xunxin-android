// JNI entrypoint based on the Node.js Mobile native Android sample.
#include <jni.h>
#include <cstring>
#include <string>
#include <vector>
#include "node.h"
#ifdef XUNXIN_ANDROID_DIAGNOSTICS
#include <android/log.h>
#include <unistd.h>
#include <thread>
static void redirectOutput(int fd, int level) {
    int pipeFd[2];
    if (pipe(pipeFd) != 0) return;
    dup2(pipeFd[1], fd);
    close(pipeFd[1]);
    std::thread([readFd=pipeFd[0], level]() {
        char buffer[2048]; ssize_t n;
        while ((n = read(readFd, buffer, sizeof(buffer)-1)) > 0) {
            buffer[n] = 0;
            __android_log_write(level, "XunxinNode", buffer);
        }
        close(readFd);
    }).detach();
}
#endif

extern "C" JNIEXPORT jint JNICALL
Java_app_floatphone_shell_LocalNodeRuntime_startNodeWithArguments(JNIEnv *env, jobject, jobjectArray arguments) {
    const jsize count = env->GetArrayLength(arguments);
    std::vector<std::string> values;
    values.reserve(count);
    size_t total = 0;
    for (jsize i = 0; i < count; ++i) {
        auto arg = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
        const char *chars = env->GetStringUTFChars(arg, nullptr);
        values.emplace_back(chars);
        total += values.back().size() + 1;
        env->ReleaseStringUTFChars(arg, chars);
        env->DeleteLocalRef(arg);
    }
    std::vector<char> buffer(total);
    std::vector<char *> argv(count);
    size_t pos = 0;
    for (jsize i = 0; i < count; ++i) {
        argv[i] = buffer.data() + pos;
        std::memcpy(argv[i], values[i].c_str(), values[i].size() + 1);
        pos += values[i].size() + 1;
    }
#ifdef XUNXIN_ANDROID_DIAGNOSTICS
    redirectOutput(STDOUT_FILENO, ANDROID_LOG_INFO);
    redirectOutput(STDERR_FILENO, ANDROID_LOG_ERROR);
#endif
    return node::Start(count, argv.data());
}
