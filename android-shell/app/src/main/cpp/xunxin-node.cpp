// JNI entrypoint based on the Node.js Mobile native Android sample.
#include <jni.h>
#include <cstring>
#include <string>
#include <vector>
#include "node.h"

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
    return node::Start(count, argv.data());
}
