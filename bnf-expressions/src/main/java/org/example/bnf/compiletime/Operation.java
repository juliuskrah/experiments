package org.example.bnf.compiletime;

import java.lang.annotation.Inherited;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Inherited
@Target(java.lang.annotation.ElementType.METHOD)
@Retention(RetentionPolicy.SOURCE)
@interface Operation {
    String expression();
}
