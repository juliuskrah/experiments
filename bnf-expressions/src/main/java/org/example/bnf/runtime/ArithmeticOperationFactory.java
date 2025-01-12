package org.example.bnf.runtime;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.lang.reflect.Proxy;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

class ArithmeticOperationFactory {
    private static final System.Logger LOG = System.getLogger(ArithmeticOperationFactory.class.getName());

    private ArithmeticOperationFactory() {
    }

    static ArithmeticOperation create(Class<? extends ArithmeticOperation> operationClass) {
        LOG.log(System.Logger.Level.INFO, "Creating proxy instance for class: {0}", operationClass.getName());
        return (ArithmeticOperation) Proxy.newProxyInstance(
                operationClass.getClassLoader(),
                new Class[] { operationClass },
                new Handler());
    }

    private static class Handler implements InvocationHandler {
        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            Operation operation = method.getAnnotation(Operation.class);
            var expression = operation.expression();
            LOG.log(System.Logger.Level.INFO, "Original expression: {0}", expression);
            var pairedParams = toParameters(method, args);
            LOG.log(System.Logger.Level.INFO, "Paired parameters: {0}", pairedParams);
            var replaced = expressed(expression, pairedParams);
            LOG.log(System.Logger.Level.INFO, "Replaced expression: {0}", replaced);
            return 27;
        }

        @SuppressWarnings("unused")
        List<String> findTokens(String expression) {
            var pattern = Pattern.compile(":(\\w+)");
            Matcher matcher = pattern.matcher(expression);
            return matcher.results().map(result -> result.group(1)).toList();
        }

        String expressed(String expression, Map<String, Object> replacements) {
            Pattern pattern = Pattern.compile(":(\\w+)");
            Matcher matcher = pattern.matcher(expression);
            // populate the replacements map ...
            StringBuilder builder = new StringBuilder();
            int i = 0;
            while (matcher.find()) {
                var replacement = replacements.get(matcher.group(1));
                builder.append(expression.substring(i, matcher.start()));
                if (replacement == null)
                    throw new IllegalArgumentException("Missing replacement for: " + matcher.group(1));
                else
                    builder.append(replacement);
                i = matcher.end();
            }
            builder.append(expression.substring(i, expression.length()));
            return builder.toString();
        }

        Map<String, Object> toParameters(Method method, Object[] args) {
            var parameters = method.getParameters();
            if (args.length != parameters.length) {
                throw new IllegalArgumentException("Invalid number of arguments");
            }
            var pairedParams = new java.util.HashMap<String, Object>();
            int i = 0;
            for (Parameter parameter : parameters) {
                if (parameter.isNamePresent()) {
                    pairedParams.put(parameter.getName(), args[i]);
                }
                i++;
            }
            return pairedParams;
        }
    }
}
