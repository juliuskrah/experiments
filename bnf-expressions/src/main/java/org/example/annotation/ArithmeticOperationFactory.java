package org.example.annotation;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.util.stream.Stream;

class ArithmeticOperationFactory {
    private ArithmeticOperationFactory() {
    }

    static ArithmeticOperation create(Class<? extends ArithmeticOperation> operationClass) {
        return (ArithmeticOperation) Proxy.newProxyInstance(
                operationClass.getClassLoader(),
                new Class[] { operationClass },
                new Handler());
    }

    private static class Handler implements InvocationHandler {
        @Override
        public Object invoke(Object proxy, java.lang.reflect.Method method, Object[] args) throws Throwable {
            if (method.isAnnotationPresent(Operation.class)) {
                Operation operation = method.getAnnotation(Operation.class);
                return switch (operation.value()) {
                    case ADD -> sum(args);
                    case SUBTRACT -> subtract(args);
                    case MULTIPLY -> multiply(args);
                    case DIVIDE -> divide(args);
                };
            }
            return null;
        }

        int sum(Object[] args) {
            return Stream.of(args).mapToInt(Integer.class::cast).sum();
        }

        short subtract(Object[] args) {
            return (short) Stream.of(args).mapToInt(Integer.class::cast).reduce((a, b) -> a - b).orElse(0);
        }

        long multiply(Object[] args) {
            return Stream.of(args).mapToInt(Integer.class::cast).reduce((a, b) -> a * b).orElse(0);
        }

        float divide(Object[] args) {
            return Stream.of(args).mapToInt(Integer.class::cast).reduce((a, b) -> a / b).orElse(0);
        }

    }
}
