package org.example.annotation;

import java.lang.annotation.*;

@Inherited
@Documented
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@interface Operation {
    OperationType value();

    public enum OperationType {
        ADD, SUBTRACT, MULTIPLY, DIVIDE
    }
}
