// 演示业务代码，版本 demo-v1；不是生产实现。
class NotificationPolicy {
    static final int MAX_ATTEMPTS = 3;
    String nextAction(int attempts, boolean acknowledged) {
        if (acknowledged) return "DELIVERED";
        if (attempts >= MAX_ATTEMPTS) return "MANUAL_REVIEW";
        return "RETRY";
    }
}
